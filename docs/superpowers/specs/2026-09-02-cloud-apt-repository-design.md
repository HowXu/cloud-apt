# Cloud APT Repository — 设计文档

> 日期: 2026-09-02 (重写: 通用部署版本, 基于 cloud-maven 架构模式)
> 状态: Draft, 待用户审阅
> 参考: 同目录下 `/home/howxu/Projects/cloud-maven/` 项目架构

## 1. 概述

### 1.1 项目定位

**通用可一键部署的 Cloudflare apt 仓库方案**。任何用户 Fork 仓库后, 通过 Cloudflare Dashboard "从 Git 导入" 即可完成部署, 无需本地 wrangler 部署、无需服务器。

定位与 [cloud-maven](https://github.com/...) 一致:
- **协议**: apt (`Release`/`InRelease`/`Packages`)
- **后端**: Cloudflare Worker (Hono + TypeScript)
- **前端**: Vue 3 + TypeScript SPA
- **存储**: Cloudflare R2 (私有)
- **运行时配置**: Cloudflare Workers KV

### 1.2 目标用户

- 想拥有私有 apt 仓库的个人 / 小团队 (Kali Linux / 自编译 deb 等场景)
- 不想运维服务器, 只想要 Cloudflare 的全球边缘 + 0 egress
- 能跑 `bash` 脚本 + 拥有 Cloudflare 账号

### 1.3 设计原则 (继承 cloud-maven)

| 原则 | 体现 |
|---|---|
| **零本地服务器** | 部署完全在 Cloudflare; 本地仅构建 + 推送 |
| **wrangler.toml 参数化** | KV id / R2 bucket name 注释掉, 用户填或 Cloudflare 自动创建 |
| **运行时配置走 KV** | site title / intro / favicon 等可改设置存 KV |
| **Bootstrap Token** | 首次部署只需设一个 Secret (ADMIN_PUSH_TOKEN) |
| **Vue 3 SPA** | 浏览界面用前端框架, Worker 只负责 API + 静态代理 |

### 1.4 非目标

- 不替代 Kali / Debian 官方源
- 不做上游 mirror
- 不做完整 admin UI (Settings 通过 wrangler secret / wrangler kv 命令管理)
- 默认单发行版 (Kali Rolling), 保留多发行版扩展位

## 2. 架构总览

```
┌─────────────────────────────┐
│  本地构建机 (用户机器)         │
│                             │
│  source/                    │
│    ↓ make                    │
│  .deb (容器内 dpkg-build)    │
│    ↓                         │
│  reprepro includedeb         │
│    ↓                         │
│  reprepro export (本地 GPG)  │
│    ↓                         │
│  build-and-push.sh           │
│    └─ PUT /api/upload/* ─────┼──┐ Bearer ADMIN_PUSH_TOKEN
└─────────────────────────────┘  │
                                   │ HTTPS
                                   ▼
┌────────────────────────────────────────────────────────────────┐
│  Cloudflare 边缘                                                 │
│                                                                 │
│  apt.example.com (用户自定义域)                                  │
│       ↓                                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Worker: cloud-apt-worker                                │   │
│  │                                                          │   │
│  │  PUT  /api/upload/{path}    [ADMIN_PUSH_TOKEN]  → R2     │   │
│  │  DELETE /api/upload/{path}  [ADMIN_PUSH_TOKEN]  → R2     │   │
│  │  POST  /api/invalidate      [ADMIN_PUSH_TOKEN]  → KV     │   │
│  │  GET   /dists/*                          → R2 (apt)      │   │
│  │  GET   /pool/*                           → R2 (apt)      │   │
│  │  GET   /pubkey.asc                       → R2            │   │
│  │  GET   /install.sh                       → R2            │   │
│  │  GET   /                                 → ASSETS (SPA)  │   │
│  │  GET   /static/*                         → ASSETS        │   │
│  │  GET   /api/index/{suite}/{arch}         → KV cache/R2   │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                       │                                  │
│       ↓                       ↓                                  │
│  ┌──────────┐            ┌──────────┐                          │
│  │ ASSETS   │            │ APT_KV   │                          │
│  │ (Vue SPA)│            │ (cache,  │                          │
│  │ dist/    │            │ settings)│                          │
│  └──────────┘            └──────────┘                          │
│       │                       │                                  │
│       ↓                       ↓                                  │
│  ┌──────────────────────────────────┐                           │
│  │  R2: cloud-apt bucket (私有)       │                           │
│  │  ├─ pool/main/.../*.deb            │                           │
│  │  ├─ dists/kali-rolling/.../{...}   │                           │
│  │  ├─ pubkey.asc                     │                           │
│  │  ├─ scripts/install.sh             │                           │
│  │  └─ static/...                     │                           │
│  └──────────────────────────────────┘                           │
└────────────────────────────────────────────────────────────────┘
            │
            │ HTTPS (apt 客户端 / 浏览器)
            ▼
┌─────────────────────────────┐
│  客户端                       │
│  ├─ apt (sources.list)      │
│  └─ 浏览器 (Vue SPA 浏览)    │
└─────────────────────────────┘
```

## 3. 核心场景

### 3.1 场景 A: 部署者 (一次性)

```bash
# 1. 在 GitHub fork 仓库
# 2. Cloudflare Dashboard → Workers & Pages → Create → Import from Git
#    选 fork 仓库, 高级设置目录设为 apt-worker
# 3. Cloudflare 自动识别 wrangler.toml, 自动创建 KV + R2 bucket
# 4. Worker → Settings → Variables → 添加 Secret:
#    ADMIN_PUSH_TOKEN = (生成的强密码)
# 5. 重新部署 (自动)
# 6. 绑定自定义域 (可选): Worker → Triggers → Custom Domains
# 7. 本地 clone fork, 跑:
./local-repo/scripts/gen-key.sh              # 生成 GPG 密钥
./local-repo/scripts/setup-reprepro.sh       # 初始化 ~/cloud-apt
./local-repo/scripts/push-key.sh             # 推送公钥到 Worker
```

### 3.2 场景 B: 构建推送 (日常)

```bash
# 本地构建
podman build -t cloud-apt-build:kali-rolling -f local-repo/dockerfiles/Dockerfile.kali-rolling .
podman run --rm -v "$PWD":/src cloud-apt-build:kali-rolling bash -c 'dpkg-buildpackage -us -uc -b'
ls ../myapp_1.2.3_amd64.deb

# 推送
export WORKER_URL=https://apt.example.com
export ADMIN_PUSH_TOKEN=xxx
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
./local-repo/scripts/build-and-push.sh ../myapp_1.2.3_amd64.deb
unset GPG_PASSPHRASE
```

脚本内部:
1. `reprepro includedeb kali-rolling myapp.deb` (本地吸收)
2. `reprepro export kali-rolling` (本地重新生成 Release + GPG 签名)
3. 列出新增/修改的文件
4. 对每个文件 `PUT /api/upload/{path}` 推送到 Worker
5. `POST /api/invalidate?suite=kali-rolling` 失效 KV 缓存

### 3.3 场景 C: 客户端使用

```bash
# 一键安装
curl -fsSL https://apt.example.com/install.sh | sudo bash

# 安装包
sudo apt update
sudo apt install myapp
```

### 3.4 场景 D: 浏览界面

浏览器访问 https://apt.example.com/

- 首页: suite 列表 + 最近上传
- /browse: 包列表
- /browse/myapp: 包详情
- /search?q=foo: 搜索

## 4. Worker API 设计

### 4.1 鉴权

所有 `/api/*` (写操作) 路由:
- Header: `Authorization: Bearer ${ADMIN_PUSH_TOKEN}`
- Token 从 Worker Secrets 读 (`env.ADMIN_PUSH_TOKEN`)
- 失败返回 `401 Unauthorized`

读操作 (`/dists/*`, `/pool/*`, `/`, `/api/index/*`) 不需鉴权。

### 4.2 推送 API

| Method | Path | 说明 |
|---|---|---|
| `PUT` | `/api/upload/{path}` | 上传单个文件 (body 是原始字节) |
| `DELETE` | `/api/upload/{path}` | 删除文件 (可选, 给 reprepro remove 用) |
| `POST` | `/api/invalidate?suite=kali-rolling` | 失效 KV 索引缓存 |

#### `PUT /api/upload/{path}` 详细

- **Auth**: Bearer token
- **Body**: 原始文件内容 (Content-Type 由客户端 header 决定, Worker 也可自动判断)
- **路径限制**: 必须以以下前缀之一开头:
  - `dists/` — apt 元数据
  - `pool/` — deb 包
  - `pubkey.asc` — 公钥 (固定 key)
  - `scripts/install.sh` — 客户端脚本 (固定 key)
  - `static/...` — 前端静态资源 (可选, 一般用 ASSETS binding)
- **拒绝**: 路径含 `..`, 绝对路径, 不在白名单前缀
- **Content-Type**: 自动判断, 客户端也可指定 `Content-Type` header
- **响应**:
  - `200 OK` 成功
  - `400 Bad Request` 路径非法
  - `401 Unauthorized` token 错
  - `413 Payload Too Large` > 100 MB (限制可调)
  - `500 Internal Server Error` R2 错误

#### `POST /api/invalidate?suite=...` 详细

- **Auth**: Bearer token
- **Query**: `suite` (例如 `kali-rolling`)
- **动作**: 删除 KV 中该 suite 的所有 arch 索引
- **响应**: `200 OK`

### 4.3 浏览 API (供 Vue SPA 调用)

```
GET /api/index/{suite}/{arch}      →  { packages: PackageEntry[] }
GET /api/index/{suite}/{arch}/search?q=foo  →  { packages: PackageEntry[] }
```

- **Auth**: 不需 (读操作, 公开)
- **响应**: JSON, 含 packages 数组, 每项 `PackageEntry = { Package, Version, Architecture, Size, Filename, Description?, Depends?, Maintainer? }`
- **实现**: Worker 从 KV 读已解析的索引 (命中返回; 未命中从 R2 读 Packages.gz, 解析后写 KV, TTL 300s)
- **错误**: suite 不存在 → `404`; 解析失败 → `500`

### 4.4 apt 协议代理

```
GET /dists/{suite}/Release       → R2 key: dists/{suite}/Release
GET /dists/{suite}/InRelease     → R2 key: dists/{suite}/InRelease
GET /dists/{suite}/main/binary-{arch}/Packages      → R2
GET /dists/{suite}/main/binary-{arch}/Packages.gz   → R2
GET /pool/{path}.deb              → R2 key: pool/{path}.deb
```

Worker 路径透传, `Cache-Control: public, max-age=300`, Cloudflare 边缘缓存。

## 5. Worker 后端结构

### 5.1 目录

```
apt-worker/
├── src/
│   ├── index.ts                # Hono app 入口, 路由注册 + SPA fallback
│   ├── env.ts                  # Bindings 类型
│   ├── upload.ts               # PUT/DELETE /api/upload/{path}
│   ├── proxy.ts                # GET /dists/*, /pool/* 代理
│   ├── api-index.ts            # GET /api/index/{suite}/{arch} JSON
│   ├── parser.ts               # Packages 文件解析
│   ├── cache.ts                # KV 缓存 + invalidate
│   └── shared/
│       ├── auth.ts             # Bearer token 校验
│       └── path.ts             # 路径校验 (白名单 + 防 ..)
├── test/                       # Vitest
│   ├── upload.test.ts
│   ├── proxy.test.ts
│   ├── parser.test.ts
│   └── auth.test.ts
├── wrangler.toml
├── wrangler-dev.toml
├── package.json
└── tsconfig.json
```

### 5.1.1 路由 fallback 设计 (`run_worker_first = true`)

`wrangler.toml` 设置 `run_worker_first = true`, Worker 先处理, 未匹配路由 fall through 到 ASSETS binding (SPA dist):

- `/api/*` → Worker 处理
- `/dists/*`, `/pool/*` → Worker 处理 (R2 代理)
- `/pubkey.asc`, `/install.sh`, `/static/*` → Worker 处理 (R2 代理)
- 其他 (`/`, `/browse`, `/browse/:pkg`, `/search`) → ASSETS (Vue SPA history 路由兜底)

SPA 用 HTML5 history 模式 (`createWebHistory`), Vue Router 在客户端处理 `/browse/:pkg` 等路径, 浏览器刷新页面时 Worker fallback 到 `index.html`。

### 5.2 Bindings (`env.ts`)

```typescript
export type Bindings = {
    ASSETS?: Fetcher;           // Vue SPA dist (Worker static assets)
    APT_BUCKET?: R2Bucket;       // apt 仓库存储
    APT_KV?: KVNamespace;        // 索引缓存 + 运行时设置
    ADMIN_PUSH_TOKEN?: string;   // Secret: Bearer token
};
```

全部 optional (Cloudflare 自动创建时 binding 也可能缺失)。

### 5.3 wrangler.toml (参数化模板)

```toml
name = "cloud-apt-worker"           # fork 者可改
main = "src/index.ts"
compatibility_date = "2026-05-29"

# 前端构建: apt-client 编译到 apt-worker/dist
[build]
command = "npm --prefix ../apt-client install && npm --prefix ../apt-client run build -- --outDir ../apt-client/dist && cp -r ../apt-client/dist ./dist && npm run build:worker"

# Worker static assets 绑定 (前端 dist)
[assets]
binding = "ASSETS"
directory = "./dist"
run_worker_first = true

# 运行时 KV (索引缓存 + settings)
[[kv_namespaces]]
binding = "APT_KV"
#id = "input your value and delete # or use cloudflare dashboard"

# R2 bucket (apt 仓库)
[[r2_buckets]]
binding = "APT_BUCKET"
#bucket_name = "input your value and delete # or use cloudflare dashboard"

# Secrets: ADMIN_PUSH_TOKEN (用 wrangler secret put 设置)
# 不在文件里写
```

## 6. Vue 3 SPA 前端

### 6.1 目录

```
apt-client/
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router.ts                # Vue Router
│   ├── site.config.ts           # 静态编译配置 (title, intro, favicon)
│   ├── api/
│   │   └── packages.ts          # 调 /api/index/...
│   ├── components/
│   │   ├── PackageCard.vue
│   │   ├── PackageTable.vue
│   │   ├── SearchBox.vue
│   │   └── Footer.vue
│   ├── pages/
│   │   ├── HomePage.vue
│   │   ├── BrowsePage.vue
│   │   ├── PackagePage.vue
│   │   └── SearchPage.vue
│   ├── composables/
│   │   └── usePackages.ts
│   ├── types.ts
│   └── env.d.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 6.2 路由

```
/                  → HomePage (suite 卡片 + 最近上传)
/browse            → BrowsePage (包列表)
/browse/:pkg       → PackagePage (包详情 + 版本列表)
/search?q=foo      → SearchPage (搜索结果)
```

### 6.3 数据流

```
组件 mounted → usePackages() → fetch /api/index/{suite}/{arch}
→ 返回 JSON → 组件渲染
```

KV 缓存在 Worker 侧做 (5 分钟 TTL + 推送时失效), SPA 只负责渲染。

### 6.4 静态配置 (`site.config.ts`)

```typescript
export const siteConfig = {
    title: "Cloud APT",
    faviconUrl: "",
    introTitle: "Personal APT Repository",
    introLines: [
        "Cloudflare Workers + R2 powered apt repository.",
        "Sign your own GPG key, deploy in 5 minutes.",
    ],
    showGithubButton: true,
    githubUrl: "https://github.com/.../cloud-apt",
};
```

用户 fork 后修改此文件重新部署。

### 6.5 风格

参考 cloud-maven 前端: Vue 3 + UnoCSS, 暗色主题, 信息密度高, 类似 npm/Debian package tracker。

## 7. 本地仓库 (`local-repo/`)

### 7.1 目录

```
local-repo/
├── conf/
│   └── distributions                 # reprepro 配置
├── scripts/
│   ├── setup-reprepro.sh             # 初始化 ~/cloud-apt
│   ├── gen-key.sh                    # 生成 GPG 密钥
│   ├── push-key.sh                   # 把公钥推到 Worker
│   ├── push-install.sh               # 把 install.sh 推到 Worker
│   ├── build-and-push.sh             # 主入口: 推送 .deb
│   ├── install.sh                    # 客户端一键脚本 (会推到 Worker)
│   └── config.env.example            # 部署配置示例
├── dockerfiles/
│   └── Dockerfile.kali-rolling       # Kali 构建容器
└── README.md                         # 本地仓库使用说明
```

### 7.2 reprepro 配置 (`conf/distributions`)

```
Origin: cloud-apt
Label: Personal APT Repository
SignWith: YOUR_EMAIL@example.com   # ← gen-key.sh 时填入

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

`SignWith` 默认用 gen-key.sh 时输入的邮箱。`Keep-Versions` 不设置 (默认无限保留, 符合 "云端历史完整" 需求)。

### 7.3 `gen-key.sh`

生成 ed25519 密钥, passphrase 保护, 文件层 AES256 加密, 输出:
- `keys/public.key` (明文公钥, 待 push)
- `keys/private.key.gpg` (私钥加密, 用户自己备份)

### 7.4 `push-key.sh` (新)

把 `keys/public.key` 推到 Worker:
```bash
curl -X PUT "https://$WORKER_URL/api/upload/pubkey.asc" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
    -H "Content-Type: text/plain" \
    --data-binary "@$KEYS_DIR/public.key"
```

### 7.5 `push-install.sh` (新)

把 `scripts/install.sh` 推到 Worker:
```bash
curl -X PUT "https://$WORKER_URL/api/upload/scripts/install.sh" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
    -H "Content-Type: text/plain" \
    --data-binary "@$SCRIPT_DIR/install.sh"
```

### 7.6 `build-and-push.sh` (主脚本, 改写)

```bash
#!/usr/bin/env bash
# 用法: ./build-and-push.sh <path-to-deb> [codename]
set -euo pipefail

DEB="${1:?需要 .deb 文件路径}"
CODENAME="${2:-kali-rolling}"

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
: "${WORKER_URL:?需要设置 WORKER_URL 环境变量}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN 环境变量}"
: "${GPG_PASSPHRASE:?需要设置 GPG_PASSPHRASE 环境变量}"

export GPG_PASSPHRASE

cd "$REPO_ROOT"

# 1. 记下推送前的文件列表 (用于 diff)
BEFORE=$(find dists pool -type f 2>/dev/null | sort)

# 2. reprepro 吸收包 + 重新生成签名元数据
reprepro includedeb "$CODENAME" "$DEB"
reprepro export "$CODENAME"

# 3. diff 出需要上传的文件
AFTER=$(find dists pool -type f 2>/dev/null | sort)
TO_UPLOAD=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER"))

# 4. 推送到 Worker
for f in $TO_UPLOAD; do
    CT="application/octet-stream"
    case "$f" in
        *.deb) CT="application/vnd.debian.binary-package" ;;
        *.gz)  CT="application/gzip" ;;
        *Release*|*InRelease|*Packages) CT="text/plain" ;;
        *.asc) CT="text/plain" ;;
    esac
    echo "  → PUT /api/upload/$f"
    curl -fsS -X PUT "https://$WORKER_URL/api/upload/$f" \
        -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
        -H "Content-Type: $CT" \
        --data-binary "@$f" || { echo "  ✗ 上传失败: $f"; exit 1; }
done

# 5. 通知 Worker 失效缓存
curl -fsS -X POST "https://$WORKER_URL/api/invalidate?suite=$CODENAME" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" || \
    echo "  ⚠ 缓存失效失败, 最多 5 分钟自动失效"

unset GPG_PASSPHRASE

PKG_NAME=$(basename "$DEB" | sed 's/_.*//')
echo ""
echo "✓ 已推送: $DEB → $CODENAME"
echo "  安装: sudo apt update && sudo apt install $PKG_NAME"
```

### 7.7 `install.sh` (客户端脚本)

模板脚本, 用 `__CLOUD_APT_DOMAIN__` 占位符标记域名:

```bash
#!/usr/bin/env bash
set -euo pipefail
DOMAIN="__CLOUD_APT_DOMAIN__"   # ← push-install.sh 时 sed 替换为真实域名
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
echo "✓ cloud-apt 已配置 (suite=$SUITE, domain=$DOMAIN)"
echo "  用 apt install <package> 安装"
```

**部署流程**:
- 仓库里是模板 (`__CLOUD_APT_DOMAIN__` 占位符)
- 用户在 `push-install.sh` 里传入真实域名:
  ```bash
  DOMAIN="apt.example.com" ./push-install.sh
  ```
- `push-install.sh` 用 sed 替换占位符, 推送到 R2
- 客户端 `curl -fsSL https://apt.example.com/install.sh | sudo bash` 直接用

### 7.8 `config.env.example` (新)

```bash
# local-repo/config.env
# Source: source config.env

export WORKER_URL="https://apt.example.com"
export ADMIN_PUSH_TOKEN="your-secret-token-here"
# GPG_PASSPHRASE 不要 export 到文件, 用 read -rs 临时设
```

## 8. GPG 密钥管理

### 8.1 每仓库独立

每个 fork 者跑 `gen-key.sh` 生成自己的 ed25519 密钥:
- Name-Email: 用户邮箱 (apt 客户端的 key id 来源)
- Expire-Date: 2y
- Passphrase: 用户自选, 记住
- 输出 `keys/public.key` (明文) + `keys/private.key.gpg` (加密)

公钥由 `push-key.sh` 推到 Worker R2 (`pubkey.asc`), 客户端从 Worker 拉。

### 8.2 私钥保护

- 永不上云 (Worker / R2 / Secrets 都不能持有)
- 仅本地 `~/cloud-apt/keys/private.key.gpg`
- 用户**强烈建议**备份到密码管理器 (1Password / Bitwarden)

### 8.3 推送时使用

`build-and-push.sh` 用环境变量 `GPG_PASSPHRASE` 解锁私钥:
- 临时 `export GPG_PASSPHRASE=$(read -rs)` 输入
- reprepro 自动调用 gpg-agent 签名 Release/InRelease
- 推送结束 `unset GPG_PASSPHRASE`

## 9. 部署流程

### 9.1 首次部署 (Fork + Cloudflare Git 导入)

```
1. GitHub: Fork cloud-apt 仓库
2. Cloudflare Dashboard:
   a. Workers & Pages → Create application → Create Worker
   b. Connect to Git → 选 fork 仓库
   c. Build settings:
      - Root directory: apt-worker
      - Build command: (留空, 用 wrangler.toml 的 [build] 配置)
   d. Deploy
3. Cloudflare 自动识别 wrangler.toml, 提示绑定 KV + R2
   - 接受默认 (Cloudflare 自动创建)
4. Worker → Settings → Variables and Secrets:
   - Add Secret: ADMIN_PUSH_TOKEN = (强密码)
5. 触发重新部署
6. Worker 域名: <random>.workers.dev
7. (可选) Worker → Triggers → Custom Domains → 添加 apt.example.com
```

### 9.2 本地初始化

```bash
git clone https://github.com/<you>/cloud-apt
cd cloud-apt
./local-repo/scripts/gen-key.sh          # 生成 GPG 密钥 (本地)
./local-repo/scripts/setup-reprepro.sh   # 初始化 ~/cloud-apt
# 编辑 ~/cloud-apt/conf/distributions, 把 SignWith 改成 gen-key.sh 时用的邮箱

export WORKER_URL=https://apt.example.com
export ADMIN_PUSH_TOKEN=xxx
./local-repo/scripts/push-key.sh         # 推送公钥
./local-repo/scripts/push-install.sh     # 推送客户端脚本
```

### 9.3 首次推送 .deb

```bash
# 编译
podman build -t cloud-apt-build:kali-rolling -f local-repo/dockerfiles/Dockerfile.kali-rolling .
podman run --rm -v "$PWD":/src cloud-apt-build:kali-rolling bash -c 'dpkg-buildpackage -us -uc -b'

# 推送
export WORKER_URL=https://apt.example.com
export ADMIN_PUSH_TOKEN=xxx
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
./local-repo/scripts/build-and-push.sh ../myapp_1.0_amd64.deb
unset GPG_PASSPHRASE
```

### 9.4 客户端首次

```bash
curl -fsSL https://apt.example.com/install.sh | sudo bash
sudo apt update && sudo apt install myapp
```

## 10. 安全考虑

| 威胁 | 缓解 |
|---|---|
| Cloudflare 账号被破 | R2 私有; Worker 鉴权后写; 私钥不存 |
| ADMIN_PUSH_TOKEN 泄露 | 攻击者可推恶意 .deb; 但 GPG 签名验证仍生效 (因为公钥已经发给客户端); 客户端拒收未签名包; **用户需轮换 token + 重新推送公钥** |
| GPG 私钥泄露 | 攻击者可签任意包; 用户需撤销旧公钥 + 推新 |
| R2 数据被篡改 | Release/InRelease GPG 签名; apt 客户端强校验 |
| Worker 被攻破 | R2 私有; ADMIN_PUSH_TOKEN 在 Secret, runtime 可访问但门槛高 |
| DDoS apt 流量 | Cloudflare 边缘免费抗; Cache-Control 缓存层 |
| 推送路径穿越攻击 | Worker 严格白名单前缀 + 防 `..` 校验 |

## 11. 项目目录总览

```
cloud-apt/                                  # 项目根
├── README.md                                # 中文 README
├── README-en.md                             # 英文 README
├── LICENSE
├── AGENTS.md
├── .gitignore
├── apt-worker/                              # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.ts
│   │   ├── env.ts
│   │   ├── upload.ts
│   │   ├── proxy.ts
│   │   ├── api-index.ts
│   │   ├── parser.ts
│   │   ├── cache.ts
│   │   └── shared/
│   │       ├── auth.ts
│   │       └── path.ts
│   ├── test/
│   ├── wrangler.toml
│   ├── wrangler-dev.toml
│   ├── package.json
│   └── tsconfig.json
├── apt-client/                              # Vue 3 SPA 前端
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router.ts
│   │   ├── site.config.ts
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── composables/
│   │   ├── types.ts
│   │   └── env.d.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── local-repo/                              # 本地仓库模板 (用户部署到 ~/cloud-apt)
│   ├── conf/
│   │   └── distributions
│   ├── scripts/
│   │   ├── setup-reprepro.sh
│   │   ├── gen-key.sh
│   │   ├── push-key.sh
│   │   ├── push-install.sh
│   │   ├── build-and-push.sh
│   │   ├── install.sh
│   │   └── config.env.example
│   ├── dockerfiles/
│   │   └── Dockerfile.kali-rolling
│   └── README.md
├── docs/
│   └── superpowers/
│       ├── specs/2026-09-02-cloud-apt-repository-design.md
│       └── plans/2026-09-02-cloud-apt-implementation.md
└── screenshots/                              # README 用截图
```

## 12. 与 cloud-maven 的设计对照

| 设计点 | cloud-maven | cloud-apt |
|---|---|---|
| 协议 | Maven | apt |
| 推送方式 | `mvn deploy` (HTTP PUT) | `build-and-push.sh` (curl PUT) |
| 元数据 | `maven-metadata.xml` (服务端生成) | `Release`/`InRelease`/`Packages` (本地 reprepro 生成) |
| GPG 签名 | 可选 | **强制** (apt 客户端强校验) |
| 鉴权 | Token (PBKDF2 hashed, KV) | Token (明文 Secret) |
| 鉴权范围 | 单 ADMIN_BOOTSTRAP_TOKEN + 多 Token (KV) | 单 ADMIN_PUSH_TOKEN |
| Admin UI | 完整 (Token CRUD + Settings) | 无 (Token 走 wrangler secret) |
| 前端 | Vue 3 SPA (管理 + 浏览) | Vue 3 SPA (仅浏览) |
| 存储 | R2 (制品) | R2 (deb + 元数据) |
| KV | 配置 + Token + Session | 配置 + 索引缓存 |
| 部署 | Fork + Cloudflare Git 导入 | 同上 |
| 本地脚本 | 无 (纯 Maven 客户端) | reprepro + 自写脚本 |
| 容器构建 | 不需要 | Dockerfile.kali-rolling |

## 13. 关键决策与权衡

### 13.1 Worker API 推送 vs rclone 直传

| 方案 | 优点 | 缺点 |
|---|---|---|
| **Worker API (本设计)** | 标准化, 鉴权清晰, 可扩展; 本地只需 Token 不需 R2 凭据 | 多一个网络跳转 |
| rclone 直传 | 简单 (一行命令) | 本地需要 R2 凭据, 不能跨机器推 |

选择: Worker API。Token 鉴权更标准, 本地不暴露 R2 凭据。

### 13.2 单 Token vs 多 Token

| 方案 | 优点 | 缺点 |
|---|---|---|
| **单 Token (本设计)** | 简单; fork 者只需设一个 Secret | 多人协作时需共享 Secret |
| 多 Token (cloud-maven 方式) | 细粒度权限 | 需 admin UI + KV 管理 |

选择: 单 Token。个人 / 小团队用, 不需要 admin UI。如果未来需要多人协作, 升级到 KV 多 Token 即可。

### 13.3 Vue SPA vs Worker SSR HTML

| 方案 | 优点 | 缺点 |
|---|---|---|
| **Vue SPA (本设计)** | 跟 cloud-maven 一致; 客户端体验好 (路由切换快); 易于扩展 | bundle 大 (但 Worker static assets 缓存) |
| Worker 渲染 HTML | bundle 小, 无需前端构建 | 交互差; 不能复用 cloud-maven 前端代码 |

选择: Vue SPA。一致性 + 体验优先。

### 13.4 单发行版默认 + 扩展位

| 方案 | 优点 | 缺点 |
|---|---|---|
| **单发行版默认 (本设计)** | 配置最简; reprepro 一套 codename; Docker 单镜像 | 偶尔需要 Debian 时手动启用 |
| 多发行版默认启用 | Kali + Debian 一套搞定 | 99% 场景冗余 |

选择: 单发行版默认 + 注释扩展位。降低初次部署门槛, 需要时启用。

## 14. 未来扩展

- **多发行版自动启用**: Admin 后台可加 (settings 页面, 不需完整 admin)
- **多 Token + KV**: 用 KV 存多 Token, 支持多人协作
- **GitHub Actions 自动构建**: tag 触发构建 + 推送
- **YubiKey 硬件签名**: 公钥不变, 私钥换硬件设备
- **包元数据增强**: README / changelog 自动抓取, 存 KV 供 SPA 展示
- **统计**: Workers Analytics Engine 记录下载量
