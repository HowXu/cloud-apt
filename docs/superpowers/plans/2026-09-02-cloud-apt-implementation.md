# Cloud APT Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建通用可一键部署的 Cloudflare apt 仓库 (Fork + Cloudflare Git 导入), 涵盖 Worker API 推送 / Vue 3 SPA 浏览 / 客户端使用三个场景。

**Architecture:** Hono Worker 提供 apt 协议代理 + 鉴权推送 API (`PUT /api/upload/{path}`) + 浏览 JSON API (`GET /api/index/{suite}/{arch}`); Vue 3 SPA 调用 Worker API 渲染浏览界面; reprepro 本地 GPG 签名后用 curl PUT 推送到 Worker。R2 私有存储, ASSETS binding 服务前端 dist。

**Tech Stack:** Cloudflare Workers · Hono · TypeScript · Vue 3 + Vite + UnoCSS · reprepro · GPG (ed25519) · curl · wrangler · Vitest · @cloudflare/vitest-pool-workers

**Spec:** `docs/superpowers/specs/2026-09-02-cloud-apt-repository-design.md`

**Reference:** `/home/howxu/Projects/cloud-maven/` (架构模式参考)

## Global Constraints

- **目标**: 通用项目, Fork + Cloudflare Dashboard Git 导入即可部署, 无需本地 wrangler 部署
- **项目命名**: `cloud-apt` (仓库/Worker/KV/R2 全用此名, fork 者可在 wrangler.toml 改)
- **Worker 名**: `cloud-apt-worker`
- **Bucket 名**: `cloud-apt` (用户可改)
- **KV namespace**: `cloud-apt-kv` (用户可改)
- **Bindings (env.ts)**: `ASSETS`, `APT_BUCKET`, `APT_KV`, `ADMIN_PUSH_TOKEN` (全部 optional)
- **默认 suite**: `kali-rolling` (注释扩展位支持多发行版)
- **架构支持**: amd64 + arm64
- **鉴权**: 单 `ADMIN_PUSH_TOKEN` via `wrangler secret put`, Bearer header
- **前端静态配置**: `apt-client/src/site.config.ts` (title, favicon, intro, github)
- **GPG**: ed25519, 2 年过期, passphrase + AES256 文件加密
- **每个 task 结束必须 commit**

## File Structure

```
cloud-apt/
├── README.md, README-en.md          # 项目总览 (中英文)
├── LICENSE, AGENTS.md, .gitignore
├── docs/superpowers/                 # spec + plan
├── apt-worker/                       # Cloudflare Worker 后端
│   ├── src/{index,env,upload,proxy,api-index,parser,cache}.ts
│   ├── src/shared/{auth,path}.ts
│   ├── test/*.test.ts
│   ├── wrangler.toml, wrangler-dev.toml
│   ├── package.json, tsconfig.json
│   └── dist/                         # 前端构建产物 (gitignored)
├── apt-client/                       # Vue 3 SPA
│   ├── src/{main,App,router,site.config}.ts
│   ├── src/api/packages.ts
│   ├── src/components/{PackageCard,PackageTable,SearchBox,Footer}.vue
│   ├── src/pages/{Home,Browse,Package,Search}Page.vue
│   ├── src/composables/usePackages.ts
│   ├── src/types.ts, env.d.ts
│   ├── package.json, vite.config.ts, tsconfig.json
│   └── dist/                         # 构建产物 (gitignored)
├── local-repo/                       # 本地仓库模板 (用户部署到 ~/cloud-apt)
│   ├── conf/distributions
│   ├── scripts/{setup-reprepro,gen-key,push-key,push-install,build-and-push}.sh
│   ├── scripts/install.sh           # 客户端一键脚本
│   ├── scripts/config.env.example
│   ├── dockerfiles/Dockerfile.kali-rolling
│   └── README.md
└── screenshots/                       # README 用图
```

---

## Phase A: 项目骨架

### Task 1: 项目根初始化

**Files:**
- Create: `README.md`, `README-en.md`, `LICENSE`, `.gitignore`, `AGENTS.md`
- Create: `package.json` (顶层 workspace)

- [ ] **Step 1: 初始化 git**

```bash
cd /home/howxu/Projects/cloud-apt
git init
git config user.email "apt@example.com"
git config user.name "cloud-apt"
```

- [ ] **Step 2: 写 `.gitignore`**

```gitignore
# Worker & client build
node_modules/
apt-worker/dist/
apt-client/dist/
.wrangler/

# Tests
coverage/

# Local repo runtime data (部署到 ~/cloud-apt 后跟 git 无关)
local-repo/conf/distributions.local
local-repo/keys/

# OS / Editor
.DS_Store
*.swp
.idea/
.vscode/

# Secrets
*.env
.env
```

- [ ] **Step 3: 写顶层 `package.json` (workspace)**

```json
{
  "name": "cloud-apt",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "apt-worker",
    "apt-client"
  ],
  "scripts": {
    "dev": "npm --workspace apt-worker run dev",
    "build": "npm --workspace apt-client run build && npm --workspace apt-worker run build",
    "deploy": "npm --workspace apt-worker run deploy",
    "test": "npm --workspace apt-worker test",
    "typecheck": "npm --workspace apt-worker run typecheck && npm --workspace apt-client run typecheck"
  }
}
```

- [ ] **Step 4: 写 `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 cloud-apt contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: 写 `AGENTS.md` (顶层)**

```markdown
# AGENTS.md

## 项目概述

Cloud APT Repository - 基于 Cloudflare Workers + R2 + KV 的通用 apt 仓库方案。
架构模式参考同目录的 `/home/howxu/Projects/cloud-maven/`。

## 子项目

- `apt-worker/` - Cloudflare Worker 后端 (Hono + TypeScript)
- `apt-client/` - Vue 3 SPA 前端
- `local-repo/` - 本地仓库模板 (reprepro + GPG + curl)

## 开发

```bash
npm install                  # 顶层安装所有 workspace
npm run dev                  # 启动 Worker (前端通过 ASSETS binding 自动服务)
npm test                     # Worker Vitest
npm run build                # 前端构建到 apt-worker/dist + Worker build
```

## 部署

参考 `README.md` 第 5 节 "部署指南"。

## Spec

`docs/superpowers/specs/2026-09-02-cloud-apt-repository-design.md`
```

- [ ] **Step 6: 写 `README.md` (中文, 完整)**

参考 cloud-maven README 结构, 但简化 (无 admin):

```markdown
<p align="center">
    <h1 align="center">Cloud-APT</h1>
    <p align="center">基于 Cloudflare Workers 的轻量 APT 私有仓库，一键部署 🎉</p>
    <p align="center">
        <a href="./README-en.md">English</a>
    </p>
</p>

## 项目简介

只需一个 Cloudflare Worker，即可部署带浏览界面的 APT 私有仓库。支持 reprepro 本地 GPG 签名 + curl 推送，apt 客户端 (`apt update && apt install`) 直接可用。

参考 [cloud-maven](https://github.com/...) 的架构模式 (Worker + Vue SPA + R2)。

## 功能特性

- **一键部署** — Fork 仓库后通过 Cloudflare Dashboard 导入，无需管理服务器
- **GPG 签名** — reprepro 本地签名，`apt` 客户端强校验通过
- **Vue 3 浏览界面** — 包列表、详情、搜索
- **R2 对象存储** — deb 文件 + apt 元数据直传 R2，0 egress 费用
- **Worker 推送 API** — `PUT /api/upload/{path}` 鉴权推送 (Bearer Token)
- **多架构** — 支持 `amd64` + `arm64`

## 项目展示

(TODO: 部署后截图)

## 技术栈

- **Runtime**: Cloudflare Workers
- **Web 框架 (后端)**: Hono
- **前端**: Vue 3 + TypeScript + Vite + UnoCSS
- **存储**: Cloudflare R2 (deb + 元数据) + Workers KV (索引缓存)
- **安全**: Bearer Token (wrangler secret), R2 私有, GPG 签名
- **本地**: reprepro + GPG (ed25519) + podman + curl

## 目录结构

```
cloud-apt
├── apt-worker/          # Cloudflare Worker 后端
├── apt-client/          # Vue 3 前端 (构建产物部署到 apt-worker/dist)
├── local-repo/          # 本地仓库模板 (部署到 ~/cloud-apt/)
└── docs/                # spec + plan
```

## 部署指南

### 1. 准备 Cloudflare 资源

Fork 本仓库到你的 GitHub 账号。

### 2. 从 Git 导入

进入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Create Worker** → **Connect to Git** → 选 fork 仓库。

高级设置：
- **Root directory**: `apt-worker`
- **Build command**: 留空 (用 wrangler.toml 的 `[build]` 配置)

### 3. 绑定资源

Cloudflare 自动识别 `wrangler.toml`，会提示绑定 KV namespace 和 R2 bucket。**接受默认**（Cloudflare 会自动创建）。

如果需要自定义：
- KV namespace: 命名为 `cloud-apt-kv`, 复制 ID 填入 wrangler.toml
- R2 bucket: 命名为 `cloud-apt`

### 4. 设置推送 Token

Worker → **Settings** → **Variables and Secrets** → **Add Secret**:

```
Name: ADMIN_PUSH_TOKEN
Value: <生成的强密码, 例如: openssl rand -hex 32>
```

### 5. 重新部署

回到 Worker → **Deployments** → 触发重新部署 (例如 push 一个空 commit)。

### 6. 绑定自定义域 (可选)

Worker → **Triggers** → **Custom Domains** → 添加 `apt.example.com`。

DNS 自动配置 CNAME → Worker。

## 本地初始化

```bash
git clone https://github.com/<you>/cloud-apt
cd cloud-apt

# 1. 生成 GPG 密钥
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
./local-repo/scripts/gen-key.sh
unset GPG_PASSPHRASE

# 2. 初始化 ~/cloud-apt
./local-repo/scripts/setup-reprepro.sh

# 3. 推送公钥到 Worker
export WORKER_URL=https://apt.example.com
export ADMIN_PUSH_TOKEN=<your-secret>
./local-repo/scripts/push-key.sh

# 4. 推送客户端脚本
./local-repo/scripts/push-install.sh
```

## 推送 .deb 包

```bash
# 编译 (容器化)
podman build -t cloud-apt-build:kali-rolling -f local-repo/dockerfiles/Dockerfile.kali-rolling .
podman run --rm -v "$PWD":/src cloud-apt-build:kali-rolling \
    bash -c 'dpkg-buildpackage -us -uc -b'

# 推送
export WORKER_URL=https://apt.example.com
export ADMIN_PUSH_TOKEN=<your-secret>
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
./local-repo/scripts/build-and-push.sh ../myapp_1.0_amd64.deb
unset GPG_PASSPHRASE
```

## 客户端使用

```bash
curl -fsSL https://apt.example.com/install.sh | sudo bash
sudo apt update && sudo apt install myapp
```

## 开发

```bash
# 本地开发 (Worker + ASSETS binding 自动服务前端)
cd apt-worker
npm run dev

# 测试
npm test

# 构建
npm run build
```

## Spec

`docs/superpowers/specs/2026-09-02-cloud-apt-repository-design.md`

## 许可证

MIT
```

- [ ] **Step 7: 写 `README-en.md` (英文版)**

跟 README.md 结构一致, 翻译为英文. (省略, 实施时直接生成)

- [ ] **Step 8: 首次 commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add .
git commit -m "chore: init repo with README, LICENSE, workspace package.json"
```

---

## Phase B: local-repo 脚本

### Task 2: reprepro 配置 + Dockerfile

**Files:**
- Create: `local-repo/conf/distributions`
- Create: `local-repo/dockerfiles/Dockerfile.kali-rolling`
- Create: `local-repo/README.md`

- [ ] **Step 1: 写 `local-repo/conf/distributions`**

```bash
mkdir -p local-repo/conf
```

```
Origin: cloud-apt
Label: Personal APT Repository
SignWith: __GPG_EMAIL__   # ← gen-key.sh 时填入实际邮箱

Codename: kali-rolling
Suite: kali-rolling
Architectures: amd64 arm64
Components: main
Description: Kali Rolling builds

# --- 扩展位: 多发行版时取消注释 ---
# Codename: bookworm
# Suite: stable
# Architectures: amd64 arm64
# Components: main
# Description: Debian Bookworm builds
```

- [ ] **Step 2: 写 `local-repo/dockerfiles/Dockerfile.kali-rolling`**

```bash
mkdir -p local-repo/dockerfiles
```

```dockerfile
FROM kalilinux/kali-rolling:latest
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential devscripts debhelper \
        fakeroot dpkg-dev git ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/bash"]
```

- [ ] **Step 3: 写 `local-repo/README.md`**

```markdown
# local-repo

本地仓库模板. 用户初始化时通过 `setup-reprepro.sh` 部署到 `~/cloud-apt/`.

## 工具要求

- reprepro (`apt install reprepro`)
- GPG 2.x (`apt install gnupg2`)
- curl (`apt install curl`)
- podman (可选, 容器化构建)

## 使用

参见项目根 README.md 的 "本地初始化" 和 "推送 .deb 包" 章节.
```

- [ ] **Step 4: Commit**

```bash
git add local-repo/conf local-repo/dockerfiles local-repo/README.md
git commit -m "feat(local-repo): reprepro config + Kali Dockerfile + README"
```

---

### Task 3: gen-key.sh + setup-reprepro.sh

**Files:**
- Create: `local-repo/scripts/gen-key.sh`
- Create: `local-repo/scripts/setup-reprepro.sh`

- [ ] **Step 1: 写 `local-repo/scripts/gen-key.sh`**

```bash
#!/usr/bin/env bash
# 一次性: 生成 GPG 密钥对 (ed25519, 2 年过期)
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
KEY_DIR="$REPO_ROOT/keys"

echo "→ GPG 密钥生成 (ed25519, 2 年过期)"
echo ""
echo "请输入 passphrase (私钥密码, 必须记住并备份):"
read -rs GPG_PASSPHRASE
echo ""

if [[ -z "$GPG_PASSPHRASE" ]]; then
    echo "✗ passphrase 不能为空" >&2
    exit 1
fi

# 询问邮箱 (会写入 reprepro.conf 的 SignWith)
read -rp "请输入 GPG 邮箱 (例如 apt@example.com): " GPG_EMAIL
if [[ -z "$GPG_EMAIL" ]]; then
    echo "✗ 邮箱不能为空" >&2
    exit 1
fi
export GPG_PASSPHRASE

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

cat >"$KEY_DIR/gpg-gen-key.conf" <<EOF
%echo Generating cloud-apt signing key
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign
Name-Real: cloud-apt archive signing key
Name-Email: $GPG_EMAIL
Expire-Date: 2y
Passphrase: $GPG_PASSPHRASE
EOF

chmod 600 "$KEY_DIR/gpg-gen-key.conf"
gpgconf --kill gpg-agent 2>/dev/null || true

gpg --batch --pinentry-mode loopback --gen-key "$KEY_DIR/gpg-gen-key.conf"

FPR=$(gpg --list-keys --with-colons "$GPG_EMAIL" | awk -F: '/^fpr:/ {print $10; exit}')

if [[ -z "$FPR" ]]; then
    echo "✗ 密钥生成失败" >&2
    exit 1
fi

# 导出公钥 (明文, 待 push)
gpg --export --armor "$FPR" > "$KEY_DIR/public.key"

# 导出私钥 (受 passphrase 保护)
gpg --export-secret-keys --armor "$FPR" > "$KEY_DIR/private.key"

# 对称加密双保险
gpg --batch --yes --pinentry-mode loopback \
    --passphrase "$GPG_PASSPHRASE" \
    --symmetric --cipher-algo AES256 \
    --output "$KEY_DIR/private.key.gpg" "$KEY_DIR/private.key"

shred -u "$KEY_DIR/private.key" "$KEY_DIR/gpg-gen-key.conf"
chmod 600 "$KEY_DIR/private.key.gpg" "$KEY_DIR/public.key"
unset GPG_PASSPHRASE

# 写入 keyid.txt 供后续脚本用
cat >"$KEY_DIR/keyid.txt" <<EOF
EMAIL=$GPG_EMAIL
FPR=$FPR
EOF
chmod 600 "$KEY_DIR/keyid.txt"

# 同步更新 conf/distributions 的 SignWith
DIST_FILE="$REPO_ROOT/conf/distributions"
if [[ -f "$DIST_FILE" ]]; then
    sed -i "s|SignWith:.*|SignWith: $GPG_EMAIL|" "$DIST_FILE"
    echo "  ✓ 已更新 $DIST_FILE 的 SignWith"
fi

echo ""
echo "✓ 密钥生成完成"
echo "  公钥: $KEY_DIR/public.key"
echo "  私钥 (加密): $KEY_DIR/private.key.gpg"
echo "  ⚠ 强烈建议把 $KEY_DIR/private.key.gpg 同步到密码管理器"
```

```bash
chmod +x local-repo/scripts/gen-key.sh
```

- [ ] **Step 2: 写 `local-repo/scripts/setup-reprepro.sh`**

```bash
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
```

```bash
chmod +x local-repo/scripts/setup-reprepro.sh
```

- [ ] **Step 3: 验证脚本语法**

```bash
bash -n local-repo/scripts/gen-key.sh
bash -n local-repo/scripts/setup-reprepro.sh
```

期望: 无输出 (语法 OK)。

- [ ] **Step 4: 跑 setup 验证目录结构生成**

```bash
mkdir -p /tmp/cloud-apt-test
CLOUD_APT_ROOT=/tmp/cloud-apt-test ./local-repo/scripts/setup-reprepro.sh
find /tmp/cloud-apt-test -maxdepth 2 -type f -o -type d | sort
```

期望: conf/, incoming/, pool/, dists/, keys/, scripts/, dockerfiles/ 都生成, conf/distributions 已拷贝。

- [ ] **Step 5: 用 reprepro 验证 distributions 可解析**

```bash
cd /tmp/cloud-apt-test
reprepro -b . export kali-rolling
```

期望: 生成 `dists/kali-rolling/Release` + `InRelease` (即使无包也是空 Release)。

- [ ] **Step 6: 清理 + Commit**

```bash
rm -rf /tmp/cloud-apt-test
git add local-repo/scripts/gen-key.sh local-repo/scripts/setup-reprepro.sh
git commit -m "feat(local-repo): gen-key.sh + setup-reprepro.sh"
```

---

### Task 4: install.sh 客户端脚本

**Files:**
- Create: `local-repo/scripts/install.sh`

- [ ] **Step 1: 写 `local-repo/scripts/install.sh`**

```bash
#!/usr/bin/env bash
# cloud-apt 客户端一键安装脚本
# 部署到 Worker R2 的 scripts/install.sh, 客户端 curl 执行
# __CLOUD_APT_DOMAIN__ 由 push-install.sh 替换
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
echo "✓ cloud-apt 已配置 (suite=$SUITE, domain=$DOMAIN)"
echo "  用 apt install <package> 安装"
```

```bash
chmod +x local-repo/scripts/install.sh
```

- [ ] **Step 2: 验证脚本语法 + 占位符存在**

```bash
bash -n local-repo/scripts/install.sh
grep -q '__CLOUD_APT_DOMAIN__' local-repo/scripts/install.sh
```

期望: 无语法错误, 占位符存在。

- [ ] **Step 3: 验证占位符替换可工作 (本地测试)**

```bash
sed 's|__CLOUD_APT_DOMAIN__|apt.example.com|' local-repo/scripts/install.sh | grep "DOMAIN="
```

期望: 输出 `DOMAIN="apt.example.com"`。

- [ ] **Step 4: Commit**

```bash
git add local-repo/scripts/install.sh
git commit -m "feat(local-repo): client install.sh template"
```

---

### Task 5: push-key.sh + push-install.sh + build-and-push.sh

**Files:**
- Create: `local-repo/scripts/push-key.sh`
- Create: `local-repo/scripts/push-install.sh`
- Create: `local-repo/scripts/build-and-push.sh`
- Create: `local-repo/scripts/config.env.example`

- [ ] **Step 1: 写 `local-repo/scripts/push-key.sh`**

```bash
#!/usr/bin/env bash
# 推送 GPG 公钥到 Worker
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
KEY_FILE="$REPO_ROOT/keys/public.key"
: "${WORKER_URL:?需要设置 WORKER_URL (例如 https://apt.example.com)}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"

if [[ ! -f "$KEY_FILE" ]]; then
    echo "✗ 找不到 $KEY_FILE, 请先跑 gen-key.sh" >&2
    exit 1
fi

echo "→ 推送公钥到 $WORKER_URL/api/upload/pubkey.asc"

curl -fsS -X PUT "$WORKER_URL/api/upload/pubkey.asc" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
    -H "Content-Type: text/plain" \
    --data-binary "@$KEY_FILE"

echo ""
echo "✓ 公钥已推送"
echo "  客户端访问 https://${WORKER_URL#https://}/pubkey.asc 应能下载到"
```

```bash
chmod +x local-repo/scripts/push-key.sh
```

- [ ] **Step 2: 写 `local-repo/scripts/push-install.sh`**

```bash
#!/usr/bin/env bash
# 推送客户端 install.sh 到 Worker (带域名替换)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${WORKER_URL:?需要设置 WORKER_URL}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"

# 从 WORKER_URL 提取域名
DOMAIN="${WORKER_URL#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"

TMP=$(mktemp)
sed "s|__CLOUD_APT_DOMAIN__|$DOMAIN|g" "$SCRIPT_DIR/install.sh" > "$TMP"

echo "→ 推送 install.sh 到 $WORKER_URL/api/upload/scripts/install.sh (domain=$DOMAIN)"

curl -fsS -X PUT "$WORKER_URL/api/upload/scripts/install.sh" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
    -H "Content-Type: text/plain; charset=utf-8" \
    --data-binary "@$TMP"

rm -f "$TMP"

echo ""
echo "✓ install.sh 已推送"
echo "  客户端: curl -fsSL https://$DOMAIN/install.sh | sudo bash"
```

```bash
chmod +x local-repo/scripts/push-install.sh
```

- [ ] **Step 3: 写 `local-repo/scripts/build-and-push.sh`**

```bash
#!/usr/bin/env bash
# 用法: ./build-and-push.sh <path-to-deb> [codename]
# 默认 codename=kali-rolling
set -euo pipefail

DEB="${1:?需要 .deb 文件路径}"
CODENAME="${2:-kali-rolling}"

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
: "${WORKER_URL:?需要设置 WORKER_URL}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"
: "${GPG_PASSPHRASE:?需要设置 GPG_PASSPHRASE}"

export GPG_PASSPHRASE

cd "$REPO_ROOT"

# 1. 记下推送前的文件列表
BEFORE=$(find dists pool -type f 2>/dev/null | sort || true)

# 2. reprepro 吸收 + 重新签名
reprepro includedeb "$CODENAME" "$DEB"
reprepro export "$CODENAME"

# 3. diff 出新增/修改文件
AFTER=$(find dists pool -type f 2>/dev/null | sort || true)
TO_UPLOAD=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER"))

if [[ -z "$TO_UPLOAD" ]]; then
    echo "⚠ 没有需要上传的文件 (deb 可能未生效)"
    exit 1
fi

# 4. 推送每个文件
for f in $TO_UPLOAD; do
    CT="application/octet-stream"
    case "$f" in
        *.deb)        CT="application/vnd.debian.binary-package" ;;
        *.gz)         CT="application/gzip" ;;
        *Release|*InRelease|*Packages) CT="text/plain" ;;
        *.asc)        CT="text/plain" ;;
    esac
    echo "  → PUT /api/upload/$f"
    if ! curl -fsS -X PUT "$WORKER_URL/api/upload/$f" \
        -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
        -H "Content-Type: $CT" \
        --data-binary "@$f"; then
        echo "  ✗ 上传失败: $f" >&2
        exit 1
    fi
done

# 5. 通知 Worker 失效缓存
curl -fsS -X POST "$WORKER_URL/api/invalidate?suite=$CODENAME" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" || \
    echo "  ⚠ 缓存失效失败, 最多 5 分钟自动失效"

unset GPG_PASSPHRASE

PKG_NAME=$(basename "$DEB" | sed 's/_.*//')
echo ""
echo "✓ 已推送: $DEB → $CODENAME"
echo "  安装: sudo apt update && sudo apt install $PKG_NAME"
```

```bash
chmod +x local-repo/scripts/build-and-push.sh
```

- [ ] **Step 4: 写 `local-repo/scripts/config.env.example`**

```bash
# local-repo/scripts/config.env
# 用法: cp config.env.example config.env, 编辑后 source config.env

export WORKER_URL="https://apt.example.com"
export ADMIN_PUSH_TOKEN="your-secret-token-from-wrangler-secret-put"
# GPG_PASSPHRASE 不要 export 到文件, 用 read -rs 临时设
```

- [ ] **Step 5: 验证所有脚本语法**

```bash
for f in local-repo/scripts/*.sh; do
    bash -n "$f" && echo "  ✓ $f"
done
```

期望: 全部 OK。

- [ ] **Step 6: 验证 build-and-push.sh 的 diff 逻辑 (模拟)**

```bash
# 创建临时仓库
TMPREPO=$(mktemp -d)
mkdir -p "$TMPREPO"/{conf,dists,pool}
cd "$TMPREPO"
echo "Package: foo
Version: 1.0
Architecture: amd64
Filename: pool/main/f/foo/foo_1.0_amd64.deb" > conf/distributions

# 创建假 deb
mkdir -p "$TMPREPO/fake"
echo "fake deb" > "$TMPREPO/fake/fake.deb"

# 用 fpm 打包
fakeroot dpkg-deb -b "$TMPREPO/fake" "$TMPREPO/fake_1.0_amd64.deb" 2>/dev/null || \
    (mkdir -p "$TMPREPO/fake/DEBIAN"
     echo "Package: fake
Version: 1.0
Architecture: amd64" > "$TMPREPO/fake/DEBIAN/control"
     fakeroot dpkg-deb -b "$TMPREPO/fake" "$TMPREPO/fake_1.0_amd64.deb")

# 测试 reprepro
reprepro -b "$TMPREPO" includedeb kali-rolling "$TMPREPO/fake_1.0_amd64.deb"
reprepro -b "$TMPREPO" export kali-rolling

find "$TMPREPO/dists" "$TMPREPO/pool" -type f | sort
```

期望: 看到 `dists/kali-rolling/Release`, `dists/kali-rolling/InRelease`, `dists/kali-rolling/main/binary-amd64/Packages`, `pool/main/f/fake/fake_1.0_amd64.deb` (路径取决于 reprepro 的 pool 整理)。

- [ ] **Step 7: 清理 + Commit**

```bash
rm -rf "$TMPREPO"
git add local-repo/scripts/push-key.sh local-repo/scripts/push-install.sh \
        local-repo/scripts/build-and-push.sh local-repo/scripts/config.env.example
git commit -m "feat(local-repo): push scripts (key, install, build) + config.env example"
```

---

## Phase C: apt-worker 后端

### Task 6: Worker 项目脚手架

**Files:**
- Create: `apt-worker/package.json`
- Create: `apt-worker/tsconfig.json`
- Create: `apt-worker/wrangler.toml`
- Create: `apt-worker/wrangler-dev.toml`

- [ ] **Step 1: 写 `apt-worker/package.json`**

```json
{
  "name": "cloud-apt-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --config wrangler-dev.toml",
    "build": "tsc --noEmit",
    "build:worker": "tsc --noEmit",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.70",
    "@cloudflare/workers-types": "^4.20250906.0",
    "typescript": "^5.7.2",
    "vitest": "^3.2.0",
    "wrangler": "^4.20.0"
  }
}
```

- [ ] **Step 2: 写 `apt-worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 写 `apt-worker/wrangler.toml` (生产, 参数化)**

```toml
name = "cloud-apt-worker"
main = "src/index.ts"
compatibility_date = "2026-05-29"

[assets]
binding = "ASSETS"
directory = "./dist"
run_worker_first = true

[observability.logs]
enabled = true

# 用户填或注释掉让 Cloudflare Dashboard 自动创建
[[kv_namespaces]]
binding = "APT_KV"
#id = "input your value and delete # or use cloudflare dashboard"

[[r2_buckets]]
binding = "APT_BUCKET"
#bucket_name = "input your value and delete # or use cloudflare dashboard"

# Secrets: ADMIN_PUSH_TOKEN (用 wrangler secret put 设置)
```

- [ ] **Step 4: 写 `apt-worker/wrangler-dev.toml` (本地开发)**

```toml
name = "cloud-apt-worker-dev"
main = "src/index.ts"
compatibility_date = "2026-05-29"

[assets]
binding = "ASSETS"
directory = "../apt-client/dist"
run_worker_first = true

[observability.logs]
enabled = true

# 本地开发用 Cloudflare 提供的 miniflare 模拟 KV + R2
[[kv_namespaces]]
binding = "APT_KV"
id = "local-dev-kv"

[[r2_buckets]]
binding = "APT_BUCKET"
bucket_name = "local-dev-bucket"

[vars]
ADMIN_PUSH_TOKEN = "dev-token-1234"
```

- [ ] **Step 5: 写 `apt-worker/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        pool: '@cloudflare/vitest-pool-workers/config',
        poolOptions: {
            workers: {
                wrangler: { configPath: './wrangler-dev.toml' },
            },
        },
    },
});
```

- [ ] **Step 6: 安装依赖**

```bash
cd /home/howxu/Projects/cloud-apt
npm install
```

期望: 顶层 + workspace 依赖安装成功, `node_modules/` 生成在根目录。

- [ ] **Step 7: 写 sanity test**

`apt-worker/test/sanity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
    it('runs', () => {
        expect(1 + 1).toBe(2);
    });
});
```

- [ ] **Step 8: 跑测试确认 setup 成功**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker
```

期望: `1 passed` (Cloudflare pool 可能慢, 给 30s 超时)。

- [ ] **Step 9: Commit**

```bash
git add apt-worker/package.json apt-worker/tsconfig.json \
        apt-worker/wrangler.toml apt-worker/wrangler-dev.toml \
        apt-worker/vitest.config.ts apt-worker/test/sanity.test.ts \
        package.json package-lock.json
git commit -m "feat(apt-worker): scaffold with Hono, Vitest, wrangler"
```

---

### Task 7: Worker env.ts (Bindings 类型)

**Files:**
- Create: `apt-worker/src/env.ts`

- [ ] **Step 1: 写 `apt-worker/src/env.ts`**

```typescript
export interface PackageEntry {
    Package: string;
    Version: string;
    Architecture: string;
    Size: number;
    Filename: string;
    Description?: string;
    Depends?: string;
    Maintainer?: string;
    Section?: string;
    Priority?: string;
}

export type Bindings = {
    ASSETS?: Fetcher;
    APT_BUCKET?: R2Bucket;
    APT_KV?: KVNamespace;
    ADMIN_PUSH_TOKEN?: string;
};

export type AppEnv = {
    Bindings: Bindings;
};
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/howxu/Projects/cloud-apt
npm run typecheck --workspace apt-worker
```

期望: 无错误。

- [ ] **Step 3: Commit**

```bash
git add apt-worker/src/env.ts
git commit -m "feat(apt-worker): Bindings types"
```

---

### Task 8: shared/path.ts (路径白名单校验)

**Files:**
- Create: `apt-worker/src/shared/path.ts`
- Create: `apt-worker/test/path.test.ts`

**Interfaces:**
- `validateUploadPath(path: string): { ok: true, key: string } | { ok: false, error: string }`

- [ ] **Step 1: 写测试**

`apt-worker/test/path.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateUploadPath } from '../src/shared/path';

describe('validateUploadPath', () => {
    it('accepts dists/ prefix', () => {
        const r = validateUploadPath('dists/kali-rolling/Release');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.key).toBe('dists/kali-rolling/Release');
    });

    it('accepts pool/ prefix', () => {
        const r = validateUploadPath('pool/main/m/myapp/myapp_1.0_amd64.deb');
        expect(r.ok).toBe(true);
    });

    it('accepts pubkey.asc', () => {
        const r = validateUploadPath('pubkey.asc');
        expect(r.ok).toBe(true);
    });

    it('accepts scripts/install.sh', () => {
        const r = validateUploadPath('scripts/install.sh');
        expect(r.ok).toBe(true);
    });

    it('rejects path traversal', () => {
        expect(validateUploadPath('../etc/passwd').ok).toBe(false);
        expect(validateUploadPath('dists/../passwd').ok).toBe(false);
    });

    it('rejects absolute paths', () => {
        expect(validateUploadPath('/etc/passwd').ok).toBe(false);
    });

    it('rejects unknown prefix', () => {
        expect(validateUploadPath('foo/bar').ok).toBe(false);
    });

    it('rejects empty', () => {
        expect(validateUploadPath('').ok).toBe(false);
    });

    it('rejects dists/ but no actual content', () => {
        expect(validateUploadPath('dists/').ok).toBe(true);  // allow directory-style
        if (validateUploadPath('dists/').ok) {
            expect(validateUploadPath('dists/').ok && (validateUploadPath('dists/') as any).key).toBe('dists/');
        }
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- path
```

期望: FAIL — module not found.

- [ ] **Step 3: 实现 `apt-worker/src/shared/path.ts`**

```typescript
const ALLOWED_PREFIXES = ['dists/', 'pool/', 'static/'];
const ALLOWED_EXACT = ['pubkey.asc', 'scripts/install.sh'];

function isPathSafe(p: string): boolean {
    if (!p) return false;
    if (p.startsWith('/')) return false;
    if (p.includes('..')) return false;
    if (p.includes('\0')) return false;
    return true;
}

export function validateUploadPath(
    path: string
): { ok: true; key: string } | { ok: false; error: string } {
    if (!isPathSafe(path)) {
        return { ok: false, error: 'Path is unsafe (traversal/absolute/null)' };
    }
    if (ALLOWED_EXACT.includes(path)) {
        return { ok: true, key: path };
    }
    for (const prefix of ALLOWED_PREFIXES) {
        if (path.startsWith(prefix)) {
            if (path === prefix) {
                return { ok: true, key: path };
            }
            if (path.length > prefix.length) {
                return { ok: true, key: path };
            }
        }
    }
    return { ok: false, error: `Path not in whitelist. Allowed: ${[...ALLOWED_PREFIXES, ...ALLOWED_EXACT].join(', ')}` };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- path
```

期望: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/shared/path.ts apt-worker/test/path.test.ts
git commit -m "feat(apt-worker): upload path whitelist validator"
```

---

### Task 9: shared/auth.ts (Bearer token)

**Files:**
- Create: `apt-worker/src/shared/auth.ts`
- Create: `apt-worker/test/auth.test.ts`

**Interfaces:**
- `checkAuth(req: Request, env: Bindings): boolean` — Header `Authorization: Bearer ${env.ADMIN_PUSH_TOKEN}` 匹配

- [ ] **Step 1: 写测试**

`apt-worker/test/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkAuth } from '../src/shared/auth';
import type { Bindings } from '../src/env';

const env = (token?: string): Bindings => ({ ADMIN_PUSH_TOKEN: token });

describe('checkAuth', () => {
    it('passes with valid Bearer token', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Bearer secret-123' },
        });
        expect(checkAuth(req, env('secret-123'))).toBe(true);
    });

    it('rejects missing header', () => {
        const req = new Request('https://x/');
        expect(checkAuth(req, env('secret-123'))).toBe(false);
    });

    it('rejects wrong scheme', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Basic secret-123' },
        });
        expect(checkAuth(req, env('secret-123'))).toBe(false);
    });

    it('rejects wrong token', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Bearer wrong' },
        });
        expect(checkAuth(req, env('secret-123'))).toBe(false);
    });

    it('rejects when env token not set', () => {
        const req = new Request('https://x/', {
            headers: { Authorization: 'Bearer secret-123' },
        });
        expect(checkAuth(req, env(undefined))).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- auth
```

期望: FAIL.

- [ ] **Step 3: 实现 `apt-worker/src/shared/auth.ts`**

```typescript
import type { Bindings } from '../env';

export function checkAuth(req: Request, env: Bindings): boolean {
    const token = env.ADMIN_PUSH_TOKEN;
    if (!token) return false;

    const header = req.headers.get('Authorization');
    if (!header) return false;
    if (!header.startsWith('Bearer ')) return false;

    const presented = header.slice('Bearer '.length);
    // 恒定时间比较 (防止时序攻击)
    if (presented.length !== token.length) return false;
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
    }
    return mismatch === 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- auth
```

期望: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/shared/auth.ts apt-worker/test/auth.test.ts
git commit -m "feat(apt-worker): Bearer token auth with constant-time compare"
```

---

### Task 10: proxy.ts (apt 流量 R2 透传)

**Files:**
- Create: `apt-worker/src/proxy.ts`
- Create: `apt-worker/test/proxy.test.ts`

**Interfaces:**
- `proxyR2(env, key, contentType?): Promise<Response>` — 从 R2 取对象, 加 Cache-Control

- [ ] **Step 1: 写测试**

`apt-worker/test/proxy.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { proxyR2 } from '../src/proxy';

const mockR2 = (files: Record<string, { body: string; type?: string }>) => ({
    get: vi.fn(async (key: string) => {
        const f = files[key];
        if (!f) return null;
        return {
            body: new ReadableStream({
                start(c) {
                    c.enqueue(new TextEncoder().encode(f.body));
                    c.close();
                },
            }),
            httpMetadata: f.type ? { contentType: f.type } : undefined,
            writeHttpMetadata: vi.fn((h: Headers) => {
                if (f.type) h.set('Content-Type', f.type);
            }),
        };
    }),
});

describe('proxyR2', () => {
    it('404 on missing', async () => {
        const env = { APT_BUCKET: mockR2({}) } as any;
        const r = await proxyR2(env, 'missing.txt');
        expect(r.status).toBe(404);
    });

    it('returns body with Cache-Control', async () => {
        const env = { APT_BUCKET: mockR2({ 'hello.txt': { body: 'hi' } }) } as any;
        const r = await proxyR2(env, 'hello.txt');
        expect(r.status).toBe(200);
        expect(r.headers.get('Cache-Control')).toBe('public, max-age=300');
        expect(await r.text()).toBe('hi');
    });

    it('uses explicit contentType override', async () => {
        const env = { APT_BUCKET: mockR2({ 'k.asc': { body: 'PGP' } }) } as any;
        const r = await proxyR2(env, 'k.asc', 'text/plain');
        expect(r.headers.get('Content-Type')).toBe('text/plain');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- proxy
```

期望: FAIL.

- [ ] **Step 3: 实现 `apt-worker/src/proxy.ts`**

```typescript
import type { Bindings } from './env';

export async function proxyR2(
    env: Bindings,
    key: string,
    contentType?: string
): Promise<Response> {
    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });

    const obj = await bucket.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=300');
    return new Response(obj.body, { headers });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- proxy
```

期望: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/proxy.ts apt-worker/test/proxy.test.ts
git commit -m "feat(apt-worker): R2 proxy with Cache-Control"
```

---

### Task 11: parser.ts (Packages 文件解析)

**Files:**
- Create: `apt-worker/src/parser.ts`
- Create: `apt-worker/test/parser.test.ts`

- [ ] **Step 1: 写测试**

`apt-worker/test/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePackages } from '../src/parser';

const sample = `Package: myapp
Version: 1.2.3
Architecture: amd64
Size: 1234567
Filename: pool/main/m/myapp/myapp_1.2.3_amd64.deb
Description: My custom app
Depends: libc6 (>= 2.34), libssl3

Package: another
Version: 0.1.0
Architecture: arm64
Size: 500000
Filename: pool/main/a/another/another_0.1.0_arm64.deb
`;

describe('parsePackages', () => {
    it('parses multiple entries', () => {
        expect(parsePackages(sample)).toHaveLength(2);
    });

    it('extracts fields', () => {
        const [a] = parsePackages(sample);
        expect(a.Package).toBe('myapp');
        expect(a.Version).toBe('1.2.3');
        expect(a.Architecture).toBe('amd64');
        expect(a.Size).toBe(1234567);
        expect(a.Filename).toBe('pool/main/m/myapp/myapp_1.2.3_amd64.deb');
        expect(a.Description).toBe('My custom app');
        expect(a.Depends).toBe('libc6 (>= 2.34), libssl3');
    });

    it('handles empty input', () => {
        expect(parsePackages('')).toEqual([]);
    });

    it('handles multi-line Description continuation', () => {
        const text = `Package: x
Version: 1
Architecture: amd64
Filename: p
Description: line one
 line two
`;
        const [a] = parsePackages(text);
        expect(a.Description).toBe('line one line two');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- parser
```

- [ ] **Step 3: 实现 `apt-worker/src/parser.ts`**

```typescript
import type { PackageEntry } from './env';

const OPTIONAL_FIELDS = ['Description', 'Depends', 'Maintainer', 'Section', 'Priority'] as const;

export function parsePackages(text: string): PackageEntry[] {
    const entries: PackageEntry[] = [];
    for (const block of text.split(/\n\n+/)) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        const fields: Record<string, string> = {};
        let currentKey = '';
        let currentValue = '';

        for (const line of trimmed.split('\n')) {
            if (/^\s/.test(line) && currentKey) {
                currentValue += ' ' + line.trim();
            } else {
                if (currentKey) fields[currentKey] = currentValue;
                const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
                if (m) {
                    currentKey = m[1];
                    currentValue = m[2];
                }
            }
        }
        if (currentKey) fields[currentKey] = currentValue;

        if (!fields.Package || !fields.Version || !fields.Architecture || !fields.Filename) continue;

        const entry: PackageEntry = {
            Package: fields.Package,
            Version: fields.Version,
            Architecture: fields.Architecture,
            Size: parseInt(fields.Size || '0', 10),
            Filename: fields.Filename,
        };
        for (const f of OPTIONAL_FIELDS) {
            if (fields[f]) (entry as any)[f] = fields[f];
        }
        entries.push(entry);
    }
    return entries;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- parser
```

期望: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/parser.ts apt-worker/test/parser.test.ts
git commit -m "feat(apt-worker): Packages file parser"
```

---

### Task 12: cache.ts (KV 缓存 + invalidate)

**Files:**
- Create: `apt-worker/src/cache.ts`
- Create: `apt-worker/test/cache.test.ts`

- [ ] **Step 1: 写测试**

`apt-worker/test/cache.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { getCachedIndex, setCachedIndex, invalidate } from '../src/cache';
import type { PackageEntry } from '../src/env';

const mockKV = () => {
    const store = new Map<string, { value: string; expiration?: number }>();
    return {
        get: vi.fn(async (key: string) => {
            const v = store.get(key);
            if (!v) return null;
            if (v.expiration && Date.now() / 1000 > v.expiration) return null;
            return { value: v.value };
        }),
        put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
            store.set(key, {
                value,
                expiration: opts?.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined,
            });
        }),
        delete: vi.fn(async (key: string) => store.delete(key)),
        list: vi.fn(async ({ prefix }: { prefix: string }) => {
            const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
            return { keys, list_complete: true };
        }),
    };
};

const entry: PackageEntry = {
    Package: 'foo', Version: '1.0', Architecture: 'amd64', Size: 100, Filename: 'p',
};

describe('cache', () => {
    it('miss returns null', async () => {
        const env = { APT_KV: mockKV() } as any;
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toBeNull();
    });

    it('round-trip', async () => {
        const env = { APT_KV: mockKV() } as any;
        await setCachedIndex(env, 'kali-rolling', 'amd64', [entry]);
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toEqual([entry]);
    });

    it('invalidate clears all arch', async () => {
        const env = { APT_KV: mockKV() } as any;
        await setCachedIndex(env, 'kali-rolling', 'amd64', [entry]);
        await setCachedIndex(env, 'kali-rolling', 'arm64', [entry]);
        await invalidate(env, 'kali-rolling');
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toBeNull();
        expect(await getCachedIndex(env, 'kali-rolling', 'arm64')).toBeNull();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- cache
```

- [ ] **Step 3: 实现 `apt-worker/src/cache.ts`**

```typescript
import type { Bindings, PackageEntry } from './env';

const TTL_SECONDS = 300;
const ARCHS = ['amd64', 'arm64'] as const;
type Arch = typeof ARCHS[number];

function key(suite: string, arch: Arch): string {
    return `idx:${suite}:${arch}`;
}

export async function getCachedIndex(
    env: Bindings,
    suite: string,
    arch: Arch
): Promise<PackageEntry[] | null> {
    const kv = env.APT_KV;
    if (!kv) return null;
    const v = await kv.get(key(suite, arch));
    if (!v) return null;
    try {
        return JSON.parse(v);
    } catch {
        return null;
    }
}

export async function setCachedIndex(
    env: Bindings,
    suite: string,
    arch: Arch,
    entries: PackageEntry[]
): Promise<void> {
    const kv = env.APT_KV;
    if (!kv) return;
    await kv.put(key(suite, arch), JSON.stringify(entries), { expirationTtl: TTL_SECONDS });
}

export async function invalidate(env: Bindings, suite: string): Promise<void> {
    const kv = env.APT_KV;
    if (!kv) return;
    await Promise.all(ARCHS.map((a) => kv.delete(key(suite, a))));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- cache
```

期望: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/cache.ts apt-worker/test/cache.test.ts
git commit -m "feat(apt-worker): KV cache for packages index"
```

---

### Task 13: upload.ts (PUT/DELETE /api/upload/{path})

**Files:**
- Create: `apt-worker/src/upload.ts`
- Create: `apt-worker/test/upload.test.ts`

**Interfaces:**
- `handleUpload(req: Request, env: Bindings): Promise<Response>` — 处理 PUT/DELETE /api/upload/{path}

- [ ] **Step 1: 写测试**

`apt-worker/test/upload.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleUpload } from '../src/upload';

const mockR2 = () => ({
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
});

const env = () => ({
    APT_BUCKET: mockR2() as any,
    ADMIN_PUSH_TOKEN: 'secret',
});

describe('handleUpload', () => {
    it('401 without Bearer', async () => {
        const req = new Request('https://x/api/upload/dists/x/Release', {
            method: 'PUT', body: 'data',
        });
        const r = await handleUpload(req, env());
        expect(r.status).toBe(401);
    });

    it('PUT uploads to R2', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/dists/kali-rolling/Release', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' },
            body: 'release data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(200);
        expect((e.APT_BUCKET.put as any).mock.calls[0][0]).toBe('dists/kali-rolling/Release');
        expect((e.APT_BUCKET.put as any).mock.calls[0][1]).toBe('release data');
    });

    it('400 for unsafe path', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/../etc/passwd', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret' },
            body: 'data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(400);
    });

    it('400 for non-whitelisted path', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/random/path', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret' },
            body: 'data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(400);
    });

    it('DELETE removes from R2', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/dists/kali-rolling/main/binary-amd64/Packages', {
            method: 'DELETE',
            headers: { Authorization: 'Bearer secret' },
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(200);
        expect((e.APT_BUCKET.delete as any).mock.calls[0][0]).toBe('dists/kali-rolling/main/binary-amd64/Packages');
    });

    it('405 for non-PUT/DELETE methods', async () => {
        const req = new Request('https://x/api/upload/dists/x', {
            method: 'GET',
            headers: { Authorization: 'Bearer secret' },
        });
        const r = await handleUpload(req, env());
        expect(r.status).toBe(405);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- upload
```

- [ ] **Step 3: 实现 `apt-worker/src/upload.ts`**

```typescript
import type { Bindings } from './env';
import { checkAuth } from './shared/auth';
import { validateUploadPath } from './shared/path';

export async function handleUpload(req: Request, env: Bindings): Promise<Response> {
    if (req.method !== 'PUT' && req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!checkAuth(req, env)) {
        return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/^\/api\/upload\//, '');

    const validated = validateUploadPath(rawPath);
    if (!validated.ok) {
        return new Response(`Bad Request: ${validated.error}`, { status: 400 });
    }

    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });

    if (req.method === 'PUT') {
        const body = await req.arrayBuffer();
        await bucket.put(validated.key, body, {
            httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' },
        });
    } else {
        await bucket.delete(validated.key);
    }

    return new Response('OK', { status: 200 });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- upload
```

期望: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/upload.ts apt-worker/test/upload.test.ts
git commit -m "feat(apt-worker): upload handler (PUT/DELETE /api/upload/{path})"
```

---

### Task 14: api-index.ts (GET /api/index/{suite}/{arch})

**Files:**
- Create: `apt-worker/src/api-index.ts`
- Create: `apt-worker/test/api-index.test.ts`

- [ ] **Step 1: 写测试**

`apt-worker/test/api-index.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleIndex, handleSearch } from '../src/api-index';

const mockR2 = (files: Record<string, string>) => ({
    get: vi.fn(async (key: string) => {
        const body = files[key];
        if (!body) return null;
        // Simulate already-decompressed (no real gzip needed for tests)
        return {
            body: new ReadableStream({
                start(c) {
                    c.enqueue(new TextEncoder().encode(body));
                    c.close();
                },
            }),
        };
    }),
});

const samplePackages = `Package: foo
Version: 1.0
Architecture: amd64
Filename: pool/main/f/foo/foo_1.0_amd64.deb
Size: 100
Description: Foo package

Package: bar
Version: 0.5
Architecture: amd64
Filename: pool/main/b/bar/bar_0.5_amd64.deb
Size: 50
Description: Bar with foo in name

`;

describe('handleIndex', () => {
    it('returns packages from cache', async () => {
        const env: any = {
            APT_BUCKET: mockR2({}),
            APT_KV: {
                get: vi.fn(async () => JSON.stringify([
                    { Package: 'cached', Version: '1.0', Architecture: 'amd64', Size: 1, Filename: 'x' },
                ])),
                put: vi.fn(),
                delete: vi.fn(),
            },
        };
        const r = await handleIndex('kali-rolling', 'amd64', env);
        const json = await r.json() as any;
        expect(json.packages[0].Package).toBe('cached');
    });

    it('falls back to R2 on cache miss', async () => {
        const env: any = {
            APT_BUCKET: mockR2({
                'dists/kali-rolling/main/binary-amd64/Packages.gz': samplePackages,
            }),
            APT_KV: {
                get: vi.fn(async () => null),
                put: vi.fn(),
                delete: vi.fn(),
            },
        };
        const r = await handleIndex('kali-rolling', 'amd64', env);
        const json = await r.json() as any;
        expect(json.packages).toHaveLength(2);
        expect(json.packages[0].Package).toBe('foo');
    });
});

describe('handleSearch', () => {
    it('filters by query', async () => {
        const env: any = {
            APT_BUCKET: mockR2({
                'dists/kali-rolling/main/binary-amd64/Packages.gz': samplePackages,
            }),
            APT_KV: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() },
        };
        const r = await handleSearch('kali-rolling', 'amd64', 'foo', env);
        const json = await r.json() as any;
        expect(json.packages.length).toBeGreaterThan(0);
        expect(json.packages.every((p: any) => p.Package.toLowerCase().includes('foo') || (p.Description || '').toLowerCase().includes('foo'))).toBe(true);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- api-index
```

- [ ] **Step 3: 实现 `apt-worker/src/api-index.ts`**

```typescript
import type { Bindings, PackageEntry } from './env';
import { getCachedIndex, setCachedIndex } from './cache';
import { parsePackages } from './parser';

const ARCHS = ['amd64', 'arm64'] as const;
type Arch = typeof ARCHS[number];

async function loadIndex(env: Bindings, suite: string, arch: Arch): Promise<PackageEntry[]> {
    const cached = await getCachedIndex(env, suite, arch);
    if (cached) return cached;

    const bucket = env.APT_BUCKET;
    if (!bucket) return [];

    const obj = await bucket.get(`dists/${suite}/main/binary-${arch}/Packages.gz`);
    if (!obj) return [];

    // Decompress gzip
    const stream = new Response(obj.body).body!.pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    const entries = parsePackages(text);
    await setCachedIndex(env, suite, arch, entries);
    return entries;
}

export async function handleIndex(suite: string, arch: string, env: Bindings): Promise<Response> {
    if (!ARCHS.includes(arch as Arch)) {
        return new Response('Invalid arch', { status: 400 });
    }
    const entries = await loadIndex(env, suite, arch as Arch);
    return Response.json({ packages: entries });
}

export async function handleSearch(
    suite: string,
    arch: string,
    query: string,
    env: Bindings
): Promise<Response> {
    if (!ARCHS.includes(arch as Arch)) {
        return new Response('Invalid arch', { status: 400 });
    }
    const all = await loadIndex(env, suite, arch as Arch);
    const q = query.toLowerCase();
    const filtered = all.filter(
        (p) =>
            p.Package.toLowerCase().includes(q) ||
            (p.Description || '').toLowerCase().includes(q) ||
            (p.Depends || '').toLowerCase().includes(q)
    );
    return Response.json({ packages: filtered });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker -- api-index
```

期望: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/api-index.ts apt-worker/test/api-index.test.ts
git commit -m "feat(apt-worker): /api/index/{suite}/{arch} + search"
```

---

### Task 15: index.ts (Hono 路由集成 + SPA fallback)

**Files:**
- Create: `apt-worker/src/index.ts`

- [ ] **Step 1: 写 `apt-worker/src/index.ts`**

```typescript
import { Hono } from 'hono';
import type { Bindings } from './env';
import { proxyR2 } from './proxy';
import { handleUpload } from './upload';
import { handleIndex, handleSearch } from './api-index';
import { invalidate } from './cache';
import { checkAuth } from './shared/auth';

const app = new Hono<{ Bindings: Bindings }>();

// 鉴权写操作
app.post('/api/invalidate', async (c) => {
    if (!checkAuth(c.req.raw, c.env)) return c.text('Unauthorized', 401);
    const suite = c.req.query('suite');
    if (!suite) return c.text('Missing suite', 400);
    await invalidate(c.env, suite);
    return c.text('OK');
});

app.all('/api/upload/*', (c) => handleUpload(c.req.raw, c.env));

// 公开读 API
app.get('/api/index/:suite/:arch', (c) =>
    handleIndex(c.req.param('suite'), c.req.param('arch'), c.env)
);
app.get('/api/index/:suite/:arch/search', (c) =>
    handleSearch(c.req.param('suite'), c.req.param('arch'), c.req.query('q') || '', c.env)
);

// apt 流量 + 静态资源 (R2)
app.get('/dists/*', (c) => proxyR2(c.env, c.req.path.slice(1)));
app.get('/pool/*', (c) => proxyR2(c.env, c.req.path.slice(1)));
app.get('/pubkey.asc', (c) => proxyR2(c.env, 'pubkey.asc', 'text/plain'));
app.get('/install.sh', (c) => proxyR2(c.env, 'scripts/install.sh', 'text/plain; charset=utf-8'));

// Health check
app.get('/api/status/health', (c) => c.json({ status: 'ok' }));

// SPA fallback: 非 API / 非 dists/pool 走 ASSETS (Vue SPA history 路由)
// run_worker_first=true 时, Worker 没匹配的请求会 fall through 到 ASSETS
app.get('*', (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dists/') ||
        url.pathname.startsWith('/pool/') || url.pathname === '/pubkey.asc' ||
        url.pathname === '/install.sh') {
        return c.notFound();
    }
    // Fallback to ASSETS
    if (!c.env.ASSETS) return c.text('SPA assets not built', { status: 500 });
    return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/howxu/Projects/cloud-apt
npm run typecheck --workspace apt-worker
```

期望: 无错误。

- [ ] **Step 3: 跑全部测试**

```bash
cd /home/howxu/Projects/cloud-apt
npm test --workspace apt-worker
```

期望: 所有测试通过 (sanity 1 + path 9 + auth 5 + proxy 3 + parser 4 + cache 3 + upload 6 + api-index 3 = 34 passed).

- [ ] **Step 4: Commit**

```bash
git add apt-worker/src/index.ts
git commit -m "feat(apt-worker): Hono routes + SPA fallback"
```

---

## Phase D: apt-client 前端

### Task 16: Vue 项目脚手架

**Files:**
- Create: `apt-client/package.json`
- Create: `apt-client/vite.config.ts`
- Create: `apt-client/tsconfig.json`

- [ ] **Step 1: 写 `apt-client/package.json`**

```json
{
  "name": "cloud-apt-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@unocss/reset": "^0.65.0",
    "unocss": "^0.65.0",
    "vue": "^3.5.0",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "@vue/tsconfig": "^0.5.1",
    "typescript": "^5.7.0",
    "vite": "^5.4.0",
    "vue-tsc": "^2.1.0"
  }
}
```

- [ ] **Step 2: 写 `apt-client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';

export default defineConfig({
    plugins: [vue(), UnoCSS()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
```

- [ ] **Step 3: 写 `apt-client/tsconfig.json`**

```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "env.d.ts"]
}
```

- [ ] **Step 4: 安装依赖**

```bash
cd /home/howxu/Projects/cloud-apt
npm install
```

期望: apt-client 依赖也安装。

- [ ] **Step 5: 创建 src 目录占位**

```bash
mkdir -p apt-client/src/{api,components,pages,composables}
echo "placeholder" > apt-client/src/main.ts
```

- [ ] **Step 6: Commit**

```bash
git add apt-client/package.json apt-client/vite.config.ts apt-client/tsconfig.json \
        package.json package-lock.json
git commit -m "feat(apt-client): scaffold with Vue 3, Vite, UnoCSS"
```

---

### Task 17: site.config.ts + types + env.d.ts + unocss.config.ts

**Files:**
- Create: `apt-client/src/site.config.ts`
- Create: `apt-client/src/types.ts`
- Create: `apt-client/src/env.d.ts`
- Create: `apt-client/uno.config.ts`

- [ ] **Step 1: 写 `apt-client/src/site.config.ts`**

```typescript
export interface SiteConfig {
    title: string;
    faviconUrl: string;
    introTitle: string;
    introLines: string[];
    showGithubButton: boolean;
    githubUrl: string;
    defaultSuite: string;
}

export const siteConfig: SiteConfig = {
    title: 'Cloud APT',
    faviconUrl: '',
    introTitle: 'Personal APT Repository',
    introLines: [
        'Cloudflare Workers + R2 powered apt repository.',
        'Sign your own GPG key, deploy in 5 minutes.',
    ],
    showGithubButton: true,
    githubUrl: 'https://github.com/<you>/cloud-apt',
    defaultSuite: 'kali-rolling',
};
```

- [ ] **Step 2: 写 `apt-client/src/types.ts`**

```typescript
export interface PackageEntry {
    Package: string;
    Version: string;
    Architecture: string;
    Size: number;
    Filename: string;
    Description?: string;
    Depends?: string;
    Maintainer?: string;
    Section?: string;
    Priority?: string;
}

export interface IndexResponse {
    packages: PackageEntry[];
}
```

- [ ] **Step 3: 写 `apt-client/src/env.d.ts`**

```typescript
/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<{}, {}, any>;
    export default component;
}
```

- [ ] **Step 4: 写 `apt-client/uno.config.ts`**

```typescript
import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss';

export default defineConfig({
    presets: [
        presetUno(),
        presetIcons(),
        presetTypography(),
    ],
    theme: {
        colors: {
            bg: '#0f1115',
            fg: '#e6e6e6',
            muted: '#888',
            accent: '#58a6ff',
            border: '#2a2e35',
            card: '#161922',
            hover: '#1d2230',
        },
        fontFamily: {
            mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        },
    },
});
```

- [ ] **Step 5: 写 `apt-client/src/main.ts`**

```typescript
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import 'virtual:uno.css';
import '@unocss/reset/tailwind.css';

import HomePage from './pages/HomePage.vue';
import BrowsePage from './pages/BrowsePage.vue';
import PackagePage from './pages/PackagePage.vue';
import SearchPage from './pages/SearchPage.vue';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/', component: HomePage },
        { path: '/browse', component: BrowsePage },
        { path: '/browse/:pkg', component: PackagePage, props: true },
        { path: '/search', component: SearchPage },
    ],
});

createApp(App).use(router).mount('#app');
```

- [ ] **Step 6: 写最小 `apt-client/src/App.vue` 占位**

```vue
<template>
  <div class="min-h-screen bg-bg text-fg font-sans">
    <router-view />
  </div>
</template>

<script setup lang="ts"></script>
```

(后面 Task 会丰富组件)

- [ ] **Step 7: 创建占位 pages (后续 Task 替换)**

```bash
mkdir -p apt-client/src/pages
for p in HomePage BrowsePage PackagePage SearchPage; do
    cat > apt-client/src/pages/${p}.vue <<EOF
<template><div>{{ '$p' }} placeholder</div></template>
<script setup lang="ts"></script>
EOF
done
```

- [ ] **Step 8: 跑 typecheck 验证**

```bash
cd /home/howxu/Projects/cloud-apt
npm run typecheck --workspace apt-client
```

期望: 无错误。

- [ ] **Step 9: Commit**

```bash
git add apt-client/src apt-client/uno.config.ts
git commit -m "feat(apt-client): site config, types, router, UnoCSS theme"
```

---

### Task 18: API client + composable

**Files:**
- Create: `apt-client/src/api/packages.ts`
- Create: `apt-client/src/composables/usePackages.ts`

- [ ] **Step 1: 写 `apt-client/src/api/packages.ts`**

```typescript
import type { IndexResponse, PackageEntry } from '../types';

const BASE = '';  // 同源

export async function fetchIndex(suite: string, arch: string): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}`);
    if (!r.ok) throw new Error(`fetchIndex failed: ${r.status}`);
    const json = (await r.json()) as IndexResponse;
    return json.packages;
}

export async function searchPackages(
    suite: string,
    arch: string,
    query: string
): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}/search?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(`searchPackages failed: ${r.status}`);
    const json = (await r.json()) as IndexResponse;
    return json.packages;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
```

- [ ] **Step 2: 写 `apt-client/src/composables/usePackages.ts`**

```typescript
import { ref, watch } from 'vue';
import type { PackageEntry } from '../types';
import { fetchIndex } from '../api/packages';

export function usePackages(suite: Ref<string>, arch: Ref<string>) {
    const packages = ref<PackageEntry[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            packages.value = await fetchIndex(suite.value, arch.value);
        } catch (e) {
            error.value = e as Error;
        } finally {
            loading.value = false;
        }
    }

    watch([suite, arch], load, { immediate: true });

    return { packages, loading, error, reload: load };
}
```

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/api apt-client/src/composables
git commit -m "feat(apt-client): API client + usePackages composable"
```

---

### Task 19: 组件 (SearchBox, PackageTable, Footer)

**Files:**
- Create: `apt-client/src/components/SearchBox.vue`
- Create: `apt-client/src/components/PackageTable.vue`
- Create: `apt-client/src/components/Footer.vue`

- [ ] **Step 1: 写 `apt-client/src/components/SearchBox.vue`**

```vue
<template>
  <form action="/search" method="get" class="w-full">
    <input
      name="q"
      class="w-full px-4 py-3 bg-card border border-border rounded-md text-fg focus:outline-none focus:border-accent"
      :placeholder="placeholder"
      autofocus
    />
  </form>
</template>

<script setup lang="ts">
defineProps<{ placeholder?: string }>();
</script>
```

- [ ] **Step 2: 写 `apt-client/src/components/PackageTable.vue`**

```vue
<template>
  <table class="w-full border-collapse mt-4">
    <thead>
      <tr class="text-muted text-sm">
        <th class="text-left px-3 py-2 border-b border-border">Package</th>
        <th class="text-left px-3 py-2 border-b border-border">Version</th>
        <th class="text-left px-3 py-2 border-b border-border">Arch</th>
        <th class="text-left px-3 py-2 border-b border-border">Size</th>
        <th class="text-left px-3 py-2 border-b border-border"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in packages" :key="`${p.Package}-${p.Version}-${p.Architecture}`" class="hover:bg-hover">
        <td class="px-3 py-2">
          <router-link :to="`/browse/${encodeURIComponent(p.Package)}`" class="text-accent no-underline hover:underline">
            {{ p.Package }}
          </router-link>
        </td>
        <td class="px-3 py-2 font-mono text-sm">{{ p.Version }}</td>
        <td class="px-3 py-2 font-mono text-sm">{{ p.Architecture }}</td>
        <td class="px-3 py-2">{{ formatSize(p.Size) }}</td>
        <td class="px-3 py-2">
          <a :href="`/${p.Filename}`" class="text-accent no-underline hover:underline">↓</a>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-if="!packages.length" class="text-muted mt-4">No packages</p>
</template>

<script setup lang="ts">
import type { PackageEntry } from '../types';
import { formatSize } from '../api/packages';

defineProps<{ packages: PackageEntry[] }>();
</script>
```

- [ ] **Step 3: 写 `apt-client/src/components/Footer.vue`**

```vue
<template>
  <footer class="mt-12 pt-4 border-t border-border text-muted text-sm">
    <p>
      Sources:
      <a href="/pubkey.asc" class="text-accent no-underline hover:underline">/pubkey.asc</a>
      ·
      Install: <code class="font-mono">curl -fsSL /install.sh | sudo bash</code>
    </p>
  </footer>
</template>

<script setup lang="ts"></script>
```

- [ ] **Step 4: Commit**

```bash
git add apt-client/src/components
git commit -m "feat(apt-client): components (SearchBox, PackageTable, Footer)"
```

---

### Task 20: Pages (Home, Browse, Package, Search)

**Files:**
- Modify: `apt-client/src/pages/HomePage.vue`
- Modify: `apt-client/src/pages/BrowsePage.vue`
- Modify: `apt-client/src/pages/PackagePage.vue`
- Modify: `apt-client/src/pages/SearchPage.vue`

- [ ] **Step 1: 写 `apt-client/src/pages/HomePage.vue`**

```vue
<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
      <span class="text-muted text-sm">personal apt repository</span>
    </header>

    <SearchBox placeholder="搜索包名、描述、依赖…" />

    <section class="mt-8">
      <h2 class="text-lg mb-4">Welcome</h2>
      <p v-for="(line, i) in siteConfig.introLines" :key="i" class="text-muted mb-2">
        {{ line }}
      </p>
    </section>

    <section class="mt-8">
      <h2 class="text-lg mb-4">Browse</h2>
      <router-link
        :to="`/browse?suite=${siteConfig.defaultSuite}&arch=amd64`"
        class="inline-block px-4 py-2 bg-card border border-border rounded-md text-accent no-underline hover:bg-hover"
      >
        Browse {{ siteConfig.defaultSuite }} (amd64)
      </router-link>
    </section>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { siteConfig } from '../site.config';
import SearchBox from '../components/SearchBox.vue';
import Footer from '../components/Footer.vue';
</script>
```

- [ ] **Step 2: 写 `apt-client/src/pages/BrowsePage.vue`**

```vue
<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/" class="text-accent no-underline hover:underline">← home</router-link></p>
    <h2 class="text-lg mt-4 mb-2">
      {{ suite }} · {{ arch }} · {{ packages.length }} packages
    </h2>

    <div v-if="loading" class="text-muted">Loading…</div>
    <div v-else-if="error" class="text-red-400">Error: {{ error.message }}</div>
    <PackageTable v-else :packages="packages" />

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { siteConfig } from '../site.config';
import { usePackages } from '../composables/usePackages';
import PackageTable from '../components/PackageTable.vue';
import Footer from '../components/Footer.vue';

const route = useRoute();
const suite = computed(() => (route.query.suite as string) || siteConfig.defaultSuite);
const arch = computed(() => (route.query.arch as string) || 'amd64');

const { packages, loading, error } = usePackages(suite, arch);
</script>
```

- [ ] **Step 3: 写 `apt-client/src/pages/PackagePage.vue`**

```vue
<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/browse" class="text-accent no-underline hover:underline">← all packages</router-link></p>

    <div v-if="loading" class="text-muted">Loading…</div>
    <div v-else-if="error" class="text-red-400">Error: {{ error.message }}</div>
    <div v-else-if="!versions.length" class="text-muted">Package not found</div>
    <div v-else>
      <h2 class="text-lg mt-4">{{ pkg }}</h2>
      <p v-if="latest?.Description" class="text-muted">{{ latest.Description }}</p>

      <h3 class="text-base mt-8 mb-2">Versions ({{ versions.length }})</h3>
      <table class="w-full border-collapse">
        <thead>
          <tr class="text-muted text-sm">
            <th class="text-left px-3 py-2 border-b border-border">Version</th>
            <th class="text-left px-3 py-2 border-b border-border">Arch</th>
            <th class="text-left px-3 py-2 border-b border-border">Size</th>
            <th class="text-left px-3 py-2 border-b border-border"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in versions" :key="`${v.Version}-${v.Architecture}`" class="hover:bg-hover">
            <td class="px-3 py-2 font-mono text-sm">{{ v.Version }}</td>
            <td class="px-3 py-2 font-mono text-sm">{{ v.Architecture }}</td>
            <td class="px-3 py-2">{{ formatSize(v.Size) }}</td>
            <td class="px-3 py-2">
              <a :href="`/${v.Filename}`" class="text-accent no-underline hover:underline">↓ download</a>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="text-base mt-8 mb-2">Metadata</h3>
      <dl class="grid grid-cols-[max-content_1fr] gap-2 gap-x-4 mt-4">
        <template v-if="latest?.Maintainer">
          <dt class="text-muted">Maintainer</dt>
          <dd>{{ latest.Maintainer }}</dd>
        </template>
        <template v-if="latest?.Depends">
          <dt class="text-muted">Depends</dt>
          <dd class="font-mono text-sm">{{ latest.Depends }}</dd>
        </template>
      </dl>
    </div>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { siteConfig } from '../site.config';
import { usePackages } from '../composables/usePackages';
import { formatSize } from '../api/packages';
import Footer from '../components/Footer.vue';

const route = useRoute();
const pkg = computed(() => decodeURIComponent((route.params.pkg as string) || ''));

const suite = computed(() => siteConfig.defaultSuite);
const arch = computed(() => 'amd64');  // 简化: 只查 amd64, 显示所有 arch

const { packages, loading, error } = usePackages(suite, arch);

const versions = computed(() =>
    packages.value
        .filter((p) => p.Package === pkg.value)
        .sort((a, b) => b.Version.localeCompare(a.Version))
);
const latest = computed(() => versions.value[0]);
</script>
```

- [ ] **Step 4: 写 `apt-client/src/pages/SearchPage.vue`**

```vue
<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.title }}</router-link>
      </h1>
    </header>

    <p class="text-muted"><router-link to="/" class="text-accent no-underline hover:underline">← home</router-link></p>

    <SearchBox :placeholder="`Search: ${query}`" />

    <h2 class="text-lg mt-4 mb-2">Search: {{ query }} · {{ results.length }} results</h2>

    <div v-if="loading" class="text-muted">Searching…</div>
    <PackageTable v-else :packages="results" />

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { siteConfig } from '../site.config';
import { searchPackages } from '../api/packages';
import type { PackageEntry } from '../types';
import SearchBox from '../components/SearchBox.vue';
import PackageTable from '../components/PackageTable.vue';
import Footer from '../components/Footer.vue';

const route = useRoute();
const query = ref((route.query.q as string) || '');
const results = ref<PackageEntry[]>([]);
const loading = ref(false);

async function doSearch() {
    if (!query.value) {
        results.value = [];
        return;
    }
    loading.value = true;
    try {
        results.value = await searchPackages(siteConfig.defaultSuite, 'amd64', query.value);
    } finally {
        loading.value = false;
    }
}

watch(query, doSearch, { immediate: true });
watch(() => route.query.q, (q) => {
    query.value = (q as string) || '';
});
</script>
```

- [ ] **Step 5: 跑 typecheck**

```bash
cd /home/howxu/Projects/cloud-apt
npm run typecheck --workspace apt-client
```

期望: 无错误。

- [ ] **Step 6: 跑 build 验证**

```bash
cd /home/howxu/Projects/cloud-apt
npm run build --workspace apt-client
ls apt-client/dist/
```

期望: dist/ 有 `index.html`, `assets/*.js`, `assets/*.css` 等。

- [ ] **Step 7: Commit**

```bash
git add apt-client/src/pages
git commit -m "feat(apt-client): pages (Home, Browse, Package, Search)"
```

---

## Phase E: 集成与端到端

### Task 21: 顶层 build command 整合

**Files:**
- Modify: 顶层 `package.json`

- [ ] **Step 1: 更新顶层 `package.json` 的 build script**

修改 `package.json`:

```json
{
  "scripts": {
    "dev": "npm --workspace apt-worker run dev",
    "build": "npm --workspace apt-client run build && npm --workspace apt-worker run build",
    "build:client": "npm --workspace apt-client run build",
    "build:worker": "npm --workspace apt-worker run build",
    "deploy": "npm --workspace apt-worker run deploy",
    "test": "npm --workspace apt-worker test",
    "typecheck": "npm --workspace apt-worker run typecheck && npm --workspace apt-client run typecheck"
  }
}
```

- [ ] **Step 2: 验证 build 流程**

```bash
cd /home/howxu/Projects/cloud-apt
npm run build
ls apt-worker/dist/
```

期望: `apt-client/dist/` 构建后, `apt-worker/dist/` 应该是空 (worker 没 dist 输出, dist 留给 ASSETS binding).

实际上 wrangler.toml 配的 `directory = "./dist"`, 但 ASSETS binding 在生产 (wrangler.toml) 指向 `./dist`. 这意味着 wrangler 期望 worker 目录里有 dist/, 但前端实际构建到 apt-client/dist.

需要协调。两种方案:

**方案 A**: 修改顶层 build script, 复制 `apt-client/dist/` → `apt-worker/dist/`

```json
"build": "npm --workspace apt-client run build && npm --workspace apt-worker run build && mkdir -p apt-worker/dist && cp -r apt-client/dist/* apt-worker/dist/"
```

**方案 B**: 修改 wrangler.toml 的 `directory`, 指向相对路径

```toml
[assets]
binding = "ASSETS"
directory = "../apt-client/dist"
```

方案 B 更干净, 但 Cloudflare Dashboard Git 导入时, wrangler.toml 的相对路径可能有问题 (因为 build context 是 apt-worker/).

我用方案 A (复制), 因为这跟 cloud-maven 的 `[build] command` 模式类似.

- [ ] **Step 3: 修正顶层 `package.json` 的 build script**

```json
"build": "npm --workspace apt-client run build && npm run build:copy && npm --workspace apt-worker run build",
"build:copy": "rm -rf apt-worker/dist && mkdir -p apt-worker/dist && cp -r apt-client/dist/* apt-worker/dist/"
```

- [ ] **Step 4: 跑 build 验证**

```bash
cd /home/howxu/Projects/cloud-apt
npm run build
ls apt-worker/dist/
```

期望: `apt-worker/dist/` 有 `index.html`, `assets/`.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: integrate client build into worker dist"
```

---

### Task 22: 端到端本地验证 (wrangler dev)

**Files:** 无

- [ ] **Step 1: 启动 wrangler dev**

```bash
cd /home/howxu/Projects/cloud-apt/apt-worker
npm run dev
```

期望: wrangler dev 启动, 输出本地 URL (例如 `http://localhost:8787`).

- [ ] **Step 2: 验证 health endpoint**

```bash
curl -fsS http://localhost:8787/api/status/health
```

期望: `{"status":"ok"}`.

- [ ] **Step 3: 验证 SPA 首页**

```bash
curl -fsS http://localhost:8787/ | head -20
```

期望: HTML 含 `<title>Cloud APT</title>`.

- [ ] **Step 4: 验证 API index (空 KV, 应返回空 packages)**

```bash
curl -fsS http://localhost:8787/api/index/kali-rolling/amd64
```

期望: `{"packages":[]}`.

- [ ] **Step 5: 验证 401 on upload without token**

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:8787/api/upload/dists/x/Release -d 'data'
```

期望: `401`.

- [ ] **Step 6: 验证 upload with token (使用 wrangler-dev.toml 的 dev-token-1234)**

```bash
curl -fsS -X PUT http://localhost:8787/api/upload/dists/kali-rolling/Release \
    -H "Authorization: Bearer dev-token-1234" \
    -H "Content-Type: text/plain" \
    -d "test release"
```

期望: `OK`.

- [ ] **Step 7: 验证 proxy 到 R2 (miniflare 模拟)**

```bash
curl -fsS http://localhost:8787/dists/kali-rolling/Release
```

期望: 输出 `test release` (从 R2 模拟回读).

- [ ] **Step 8: 验证 invalid path 被拒**

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" -X PUT \
    http://localhost:8787/api/upload/../etc/passwd \
    -H "Authorization: Bearer dev-token-1234" \
    -d 'data'
```

期望: `400`.

- [ ] **Step 9: 跑全部测试**

```bash
cd /home/howxu/Projects/cloud-apt
npm test
```

期望: 全部通过 (34+ passed).

- [ ] **Step 10: 关闭 wrangler dev (Ctrl+C)**

- [ ] **Step 11: Commit (空, 标记本地验证通过)**

```bash
git commit --allow-empty -m "chore: local end-to-end verification passed"
```

---

### Task 23: 文档完善

**Files:**
- Modify: `README.md`, `README-en.md`
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: 在 README 加详细截图占位**

在 README.md 的 "项目展示" 章节加占位:

```markdown
## 项目展示

部署后访问 `https://<your-worker-domain>/` 可见:

- 首页: suite 列表 + 搜索框
- 包列表: `/browse?suite=kali-rolling&arch=amd64`
- 包详情: `/browse/<package-name>`
- 搜索: `/search?q=<query>`

(TODO: 截图)
```

- [ ] **Step 2: 写 `docs/DEPLOY.md` (部署完整步骤)**

```markdown
# 部署指南

参考 README.md 第 "部署指南" 章节的精简版, 这里是完整版.

## Fork + Cloudflare Git 导入

### 步骤 1: Fork 仓库

访问 https://github.com/<owner>/cloud-apt, 点击 Fork.

### 步骤 2: 创建 Cloudflare Worker

1. 登录 https://dash.cloudflare.com/
2. Workers & Pages → Create application → Create Worker
3. 命名: `cloud-apt-worker` (可改)
4. Connect to Git → 选 fork 仓库
5. **Build settings**:
   - Root directory: `apt-worker`
   - Build command: 留空
6. Deploy

### 步骤 3: 绑定资源 (首次部署)

Cloudflare 自动识别 `wrangler.toml`, 弹出配置 KV + R2:

- KV namespace: 命名 `cloud-apt-kv`, 复制 ID 填入 `wrangler.toml` (或保留注释, 让 Cloudflare 自动)
- R2 bucket: 命名 `cloud-apt`

如果 Cloudflare 已自动创建 (无 ID), wrangler.toml 保持注释即可.

### 步骤 4: 设置推送 Token

Worker → Settings → Variables and Secrets → Add Secret:

```
Name: ADMIN_PUSH_TOKEN
Value: <openssl rand -hex 32 的输出>
```

### 步骤 5: 触发重新部署

Worker → Deployments → Create deployment (或 push 空 commit 到 fork).

### 步骤 6: 绑定自定义域 (可选)

Worker → Triggers → Custom Domains → 添加 `apt.example.com`.

### 步骤 7: 验证

访问 `https://<your-worker>.workers.dev/api/status/health` → `{"status":"ok"}`.

访问 `/` → Vue SPA 首页.

## 本地初始化

```bash
git clone https://github.com/<you>/cloud-apt
cd cloud-apt

# 1. 安装依赖
npm install

# 2. 生成 GPG 密钥
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
./local-repo/scripts/gen-key.sh
unset GPG_PASSPHRASE

# 3. 初始化 ~/cloud-apt
./local-repo/scripts/setup-reprepro.sh

# 4. 设置环境变量
export WORKER_URL=https://<your-domain>
export ADMIN_PUSH_TOKEN=<your-secret>

# 5. 推送公钥
./local-repo/scripts/push-key.sh

# 6. 推送客户端脚本
./local-repo/scripts/push-install.sh
```

## 推送 .deb

```bash
export WORKER_URL=https://<your-domain>
export ADMIN_PUSH_TOKEN=<your-secret>
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
./local-repo/scripts/build-and-push.sh ../myapp_1.0_amd64.deb
unset GPG_PASSPHRASE
```

## 客户端使用

```bash
curl -fsSL https://<your-domain>/install.sh | sudo bash
sudo apt update && sudo apt install myapp
```

## 故障排查

### wrangler deploy 失败

- 检查 wrangler.toml 里的 KV id / R2 bucket name 是否有效
- 确认已 `wrangler login` 或 CI token 有效

### push-key.sh 401

- 检查 ADMIN_PUSH_TOKEN 是否跟 wrangler secret put 设置的一致
- 确认 Worker 已重新部署

### apt update 报 GPG 错误

- 确认 pubkey.asc 已 push (curl -fsSL https://<domain>/pubkey.asc | head -3)
- 确认 sources.list 的 Signed-By 路径正确

### SPA 404

- 确认 wrangler.toml 的 `[assets]` 配置存在
- 确认 build 流程执行了 (`apt-worker/dist/` 有文件)
```

- [ ] **Step 3: Commit**

```bash
git add README.md README-en.md docs/DEPLOY.md
git commit -m "docs: deployment guide + screenshots placeholder"
```

---

### Task 24: 最终验证 + README 链接检查

**Files:**
- Modify: 文档链接

- [ ] **Step 1: 跑全部测试**

```bash
cd /home/howxu/Projects/cloud-apt
npm test
npm run typecheck
```

期望: 全部通过.

- [ ] **Step 2: 跑 build**

```bash
cd /home/howxu/Projects/cloud-apt
npm run build
```

期望: 成功.

- [ ] **Step 3: 检查 README 链接**

```bash
# 确保所有链接有效
grep -r 'http' README.md README-en.md AGENTS.md docs/DEPLOY.md
```

- [ ] **Step 4: 完整 git log 检查**

```bash
cd /home/howxu/Projects/cloud-apt
git log --oneline
```

期望: 24+ 个 commit, 涵盖所有 phase.

- [ ] **Step 5: 最终标记**

```bash
git commit --allow-empty -m "chore: cloud-apt v0.1.0 ready for deployment"
```

---

## Summary

完成 24 个 Task 后, 你拥有:

✅ 通用可一键部署的 Cloudflare apt 仓库方案 (跟 cloud-maven 同架构模式)

✅ Worker 后端 (apt-worker/):
- Hono 路由: apt 流量代理 + 推送 API + 浏览 API + SPA fallback
- R2 透传 + Cache-Control 缓存
- Bearer token 鉴权 + 路径白名单防穿越
- KV 索引缓存 + invalidate
- Vitest 测试覆盖 (34+ 个测试)

✅ Vue 3 SPA 前端 (apt-client/):
- 路由: / /browse /browse/:pkg /search
- UnoCSS 主题 (深色, 信息密度高)
- 调 Worker API 渲染

✅ 本地仓库模板 (local-repo/):
- reprepro 配置 (单发行版默认 + 扩展位)
- Dockerfile.kali-rolling 容器构建
- gen-key / setup-reprepro / push-key / push-install / build-and-push 脚本
- install.sh 客户端一键安装

✅ 部署文档 (README + README-en + docs/DEPLOY.md) — Fork + Cloudflare Git 导入 + wrangler secret, 5 分钟上线

✅ 端到端本地验证通过 (wrangler dev + 健康检查 + 上传/下载 + 鉴权 + 路径校验)
