<p align="center">
    <h1 align="center">Cloud-APT</h1>
    <p align="center">基于 Cloudflare Workers 的轻量 APT 私有仓库，一键部署 🎉</p>
    <p align="center">
        <a href="./README-en.md">English</a>
    </p>
</p>

## 项目简介

只需一个 Cloudflare Worker，即可部署带浏览界面的 APT 私有仓库。支持 reprepro 本地 GPG 签名 + curl 推送，apt 客户端 (`apt update && apt install`) 直接可用。

参考 [cloud-maven](https://github.com/HowXu/cloud-maven) 的架构模式 (Worker + Vue SPA + R2)。

## 功能特性

- **一键部署** — Fork 仓库后通过 Cloudflare Dashboard 导入，无需管理服务器
- **GPG 签名** — reprepro 本地签名，`apt` 客户端强校验通过
- **Vue 3 浏览界面** — 包列表、详情、搜索
- **R2 对象存储** — deb 文件 + apt 元数据直传 R2，0 egress 费用
- **Worker 推送 API** — `PUT /api/upload/{path}` 鉴权推送 (Bearer Token)
- **多架构** — 支持 `amd64` + `arm64`

## 项目展示

部署后访问 `https://<your-worker-domain>/` 可见:

- 首页: suite 列表 + 搜索框
- 包列表: `/browse?suite=kali-rolling&arch=amd64`
- 包详情: `/browse/<package-name>`
- 搜索: `/search?q=<query>`

(TODO: 截图)

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

## 安全审计

- v1: [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)
- v2: [docs/SECURITY-AUDIT-2.md](docs/SECURITY-AUDIT-2.md)

## 许可证

MIT