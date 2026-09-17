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
├── apt-worker/          # Cloudflare Worker 后端 (TypeScript)
├── apt-client/          # Vue 3 前端 (构建产物部署到 apt-worker/dist)
├── local-repo/          # 本地仓库模板 (部署到 ~/cloud-apt/)
│   ├── scripts/         # 发布/迁移/初始化 (薄 bash 壳 + Python 实现)
│   │   ├── init.sh / push.sh / build-and-push.sh
│   │   ├── migrate-export.sh / migrate-import.sh
│   │   ├── push-key.sh / push-install.sh / gen-key.sh
│   │   ├── publish.py    # 核心: 快照、上传 by-hash、签名提交
│   │   ├── migrate.py    # 核心: 导出/导入 + GPG 加密 config.env
│   │   ├── repo_state.py # 共享: GPG home、repo 锁、SHA256
│   │   └── lib-*.sh      # bash 公共 (config + UI)
│   ├── conf/            # reprepro distributions (运行后产生)
│   ├── keys/            # GPG 密钥对 (gitignored)
│   └── ...              # db/ pool/ dists/ incoming/ 运行时生成
├── example/             # 端到端测试用 .deb 样例
│   ├── build.sh         # 一键构建所有 (cloud-apt-hello + cloud-apt-info)
│   ├── cloud-apt-hello/ # C, libc6
│   └── cloud-apt-info/  # Python, python3
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

完整部署 + 故障排查 + Token 轮换 + 安全附录见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 本地初始化

```bash
git clone https://github.com/<you>/cloud-apt
cd cloud-apt
./local-repo/scripts/init.sh
```

`init.sh` 会交互询问 Worker URL、上传 Token 和 GPG passphrase, 然后完成本地仓库结构、密钥生成、公钥与客户端脚本上传。

## 推送 .deb 包

```bash
./local-repo/scripts/push.sh ../myapp_1.0_amd64.deb
```

`push.sh` 会临时提示输入 GPG passphrase，随后生成带 by-hash 的签名索引、保存发布快照、上传并校验全部引用文件，最后切换当前版本。中断后可重试原命令或使用 `build-and-push.sh --resume`；发布与迁移的完整说明见 [local-repo/README.md](local-repo/README.md)。升级时先部署新版 Worker，再使用新版发布脚本。

## 客户端使用

```bash
curl -fsSL https://apt.example.com/install.sh | sudo bash
sudo apt update && sudo apt install myapp
```

## 备份与恢复

迁移、跨机、灾难恢复都靠这两个脚本。生成的 tar.gz **包含所有可恢复状态**——顶部 `EXPORT-MANIFEST.json` 校验 magic + 文件 SHA256，**`config.env` 用仓库自身的 GPG 公钥加密**（tar.gz 里看到的是 `config.env.gpg`，不是明文）。

### 导出仓库状态

```bash
./local-repo/scripts/migrate-export.sh /safe/path/cloud-apt-export-$(date +%Y%m%d).tar.gz
```

打包内容：
- `keys/`（加密私钥 + 公钥 + `keyid.txt`）
- `conf/`（reprepro 配置）
- `db/`（reprepro 数据库）
- `pool/`（包文件）
- `dists/`（索引 + 签名）
- `config.env.gpg`（`config.env` 用 `keys/public.key` 的公钥加密后的产物）

**不含** `.publish/`（发布暂存）、脚本本身。

### 导入恢复

```bash
./local-repo/scripts/migrate-import.sh /path/to/cloud-apt-export-XXX.tar.gz
./local-repo/scripts/push.sh path/to/package.deb
```

导入脚本会自动：
- 用 GPG 私钥（passphrase 已在导入时输入）解密 `config.env.gpg` 到 `local-repo/config.env`
- 替换 state 子目录
- 在 `dists/` 非空时自动跑 `./local-repo/scripts/build-and-push.sh --sync kali-rolling`（失败仅警告）

**不需要** 跑 `init.sh`，**不需要** 手动 `--sync`。

### 跨机迁移完整流程

1. **源机器**：`migrate-export.sh`；把 tar.gz 拷到 U 盘/远端存储
2. **目标机器**：克隆本仓库
3. **目标机器**：`migrate-import.sh` 解压 tar.gz
   - 脚本会**交互提示**输入 GPG passphrase（用于解锁 `keys/private.key.gpg`），同一 passphrase 顺便解密 `config.env.gpg`
4. **目标机器**：直接 `./local-repo/scripts/push.sh path/to/package.deb`

> 如果源机器的 GPG 私钥已经从 keyring 删了（参见 `gen-key.sh` 文档），但 `keys/private.key.gpg` 加密备份还在——`migrate-import.sh` 依然有效，对称加密只依赖 passphrase、不依赖 keyring 里的私钥。

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

审计记录通过 GitHub 历史 commit 保留, 请到仓库的 `docs/` 目录对应 commit 查阅:
- v1: <https://github.com/<you>/cloud-apt/blob/5fb037a/docs/SECURITY-AUDIT.md>
- v2: <https://github.com/<you>/cloud-apt/blob/d05e437/docs/SECURITY-AUDIT-2.md>
- v3: <https://github.com/<you>/cloud-apt/blob/0314f08/docs/SECURITY-AUDIT-3.md>

## 许可证

MIT
