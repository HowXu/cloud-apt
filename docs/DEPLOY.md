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