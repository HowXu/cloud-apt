<p align="center">
    <h1 align="center">Cloud APT</h1>
    <p align="center">基于 Cloudflare Workers 的轻量 APT 私有仓库，一键部署 🎉</p>
    <p align="center">
        <a href="./README-en.md">English</a>
    </p>
</p>

![alt text](image.png)

# Cloud APT

## 简介

只需一个 Cloudflare Worker，即可部署带浏览界面的 APT 私有仓库

支持本地 GPG 签名 + curl 推送，客户端直接可用。Worker 把每个 `.deb` 按内容寻址存进 R2，本地仓库仅保留签名密钥和一份 `packages.json` 清单。

参考 [cloud-maven](https://github.com/HowXu/cloud-maven)的架构模式

## 功能特性

- **一键部署** — Fork 仓库后通过 Cloudflare Dashboard 导入，无需管理服务器
- **GPG 签名** — 本地 GPG 签名 (ed25519)，`apt` 客户端强校验通过
- **Vue 3 浏览界面** — 包列表、详情、搜索
- **R2 对象存储** — deb 文件与 apt 元数据直传 R2，按 sha256 不可变
- **Worker 推送 API** — `PUT /api/upload/{path}` 鉴权推送
- **多架构支持**

## 技术栈

- **Runtime**: Cloudflare Workers
- **Web框架**: Hono
- **前端**: Vue 3 + TypeScript + Vite + UnoCSS
- **存储**: Cloudflare R2  + Workers KV
- **安全**: Bearer Token, R2 私有, GPG 签名
- **本地**: GPG (ed25519) + curl + Python 3.10+ (标准库)

## 目录结构

```
cloud-apt
├── apt-worker/           # Cloudflare Worker 后端
├── apt-client/           # Vue 3 前端
├── local-repo/           # 本地仓库模板
│   ├── scripts/          # 发布/迁移/初始化
│   │   ├── init.sh / push.sh / build-and-push.sh
│   │   ├── migrate-export.sh / migrate-import.sh
│   │   ├── push-key.sh / push-install.sh / gen-key.sh
│   │   ├── publish.py    # 核心: 快照、上传 by-hash、签名提交
│   │   ├── migrate.py    # 核心: 导出/导入 + GPG 加密 config.env
│   │   ├── repo_state.py # 共享: GPG home、repo 锁、SHA256
│   │   └── lib-*.sh      # bash 公共
│   ├── conf/             # APT 发行版元数据 (Suite/Architectures/Components)
│   ├── keys/             # GPG 密钥对
│   └── packages.json     # 从 worker 同步的包目录
└── example/              # 端到端测试用 .deb 样例
    ├── build.sh          # 构建
    ├── cloud-apt-hello/  # C, libc6
    └── cloud-apt-info/   # Python, python3

```

# 部署指南

## Cloudflare部署

### 1. 准备 Cloudflare 资源

Fork 本仓库到你的 GitHub 账号

### 2. 从 Git 导入

进入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Create Worker** → **Connect to Git** → 选择你 fork 的仓库

高级设置：
- **Root directory**: `apt-worker`
- **Build command**: 留空 (用 wrangler.toml 的 `[build]` 配置)

### 3. 绑定资源

Cloudflare 自动识别 `wrangler.toml`，会自动绑定需要的 KV namespace 和 R2 bucket。此项目已提前写好配置文件，可以一键导入

如果需要自定义：
- KV namespace: 命名为 `cloud-apt-kv`, 复制 ID 填入 wrangler.toml
- R2 bucket: 命名为 `cloud-apt`

### 4. 设置推送 Token

这个步骤只能通过以下方式设置，在导入时调整高级设置是无效的

Worker → **Settings** → **Variables and Secrets** → **Add Secret**:

```
Name: ADMIN_PUSH_TOKEN
Value: <生成的强密码>
```

### 5. 设置 R2 API Token（用于大于 100 MB 的 .deb 预签名上传）

进入 **R2** → **Manage R2 API Tokens** → **Create API Token**：
- Permissions: Object Read & Write
- Bucket: 选择与 Worker 绑定的 bucket（默认 `cloud-apt`）

创建后把以下三项加入 Worker → **Settings** → **Variables and Secrets**：

| Name | Type | Value |
| --- | --- | --- |
| `R2_ACCESS_KEY_ID` | Secret | API Token 的 `Access Key ID` |
| `R2_SECRET_ACCESS_KEY` | Secret | API Token 的 `Secret Access Key` |
| `R2_ACCOUNT_ID` | Variable | Cloudflare 账户 ID（R2 概览页可见） |
| `R2_BUCKET_NAME` | Variable | Bucket 名（默认 `cloud-apt`） |

设置完成后重新部署 Worker。

### 5. 重新部署

当前 Cloudflare 会自动在设置 Token 后触发自动构建，你可以跳过这一步

回到 Worker → **Deployments** → 触发重新部署 (例如 push 一个空 commit)

### 6. 绑定自定义域(可选)

Worker → **Triggers** → **Custom Domains** → 添加 `apt.example.com`。

## 推送软件包

### 1. 本地初始化

```bash
git clone https://github.com/HowXu/cloud-apt
cd cloud-apt
./local-repo/scripts/init.sh
```

`init.sh` 会交互询问 Worker URL、上传 Token 和 GPG passphrase, 然后完成本地仓库结构、密钥生成、公钥与客户端脚本上传

这是一个完全自动的脚本，你只需要确保你的网络和密码正确。输入错误或者某一步骤失败都可以直接重试，Cloud APT 有一套完善的恢复措施

### 2. 推送

```bash
./local-repo/scripts/push.sh ../myapp_1.0_amd64.deb
```

`push.sh` 会临时提示输入 GPG passphrase，随后生成带 by-hash 的签名索引、保存发布快照、上传并校验全部引用文件，最后切换当前版本。

中断后可重试原命令，发布与迁移的完整说明见 [local-repo/README.md](local-repo/README.md)

升级时先部署新版 Worker，再使用新版发布脚本

## 客户端使用

```bash
curl -fsSL https://apt.example.com/install.sh | sudo bash
# 你也可以使用标准的APT仓库源方法
sudo apt update && sudo apt install myapp
```

## 备份与恢复

### 1. 导出仓库状态

```bash
./local-repo/scripts/migrate-export.sh /path/set-a-name.tar.gz
```

内容包括：
- `keys`:加密私钥，公钥，以及`keyid.txt`
- `conf`:APT 发行版元数据
- `packages.json`:worker 应该服务的全部 deb 目录
- `dists`:最近一次的已签名索引（可选，worker 也保留这些）
- `config.env.gpg`:`config.env` 用 `keys/public.key` 的公钥加密后的产物


### 2.导入恢复

```bash
./local-repo/scripts/migrate-import.sh /path/set-a-name.tar.gz
./local-repo/scripts/push.sh --sync kali-rolling   # 同步 packages.json 与 server
./local-repo/scripts/push.sh path/to/package.deb
```

导入脚本会自动：
- 用 GPG 私钥解密 `config.env.gpg` 到 `local-repo/config.env`
- 替换 `local-repo/` 下的 state 子目录
- 把旧 state 与 publish staging 备份到 `<target>.bak.<unique-suffix>`

## 开发

```bash
# 本地开发
cd apt-worker
npm run dev

# 测试
npm test

# 构建
npm run build
```