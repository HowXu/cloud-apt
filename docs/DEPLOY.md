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
   - **Build command: 留空** ← 必须留空, 由 `wrangler.toml` 的 `[build]` 段接管前端构建 (见下方说明)
6. Deploy

> **为什么 Build command 留空？**
>
> `apt-worker/wrangler.toml` 已包含一个 `[build]` 段:
> ```toml
> [build]
> command = "npm --prefix ../apt-client install --no-audit --prefer-offline && npm --prefix ../apt-client run build -- --outDir ../apt-worker/dist --emptyOutDir"
> ```
> Cloudflare 会在 `wrangler deploy` 之前自动运行这段命令, 把 Vue 前端构建到 `apt-worker/dist/`, 供 `[assets]` 段读取。
>
> 如果在 Dashboard 填写 Build command, 会和 `[build]` 段冲突, 导致 `apt-worker/dist` 不存在, 报:
> ```
> ✘ [ERROR] The directory specified by the "assets.directory" field in your configuration file does not exist:
>     /opt/buildhome/repo/apt-worker/dist
> ```

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

## 移除包

```bash
./local-repo/scripts/build-and-push.sh --remove <pkg>
```

调用 `reprepro remove` + `reprepro export`, 只上传变更的 `dists/*`.
默认会交互式确认, 设置 `YES=1` 跳过确认 (CI / 脚本场景).
用于下架某个版本而无需重新打包 .deb.

## 手动 reprepro 编辑后同步

```bash
./local-repo/scripts/build-and-push.sh --sync
```

只调用 `reprepro export` 并上传 `dists/*`. 用于 `reprepro expire`,
`reprepro filter` 等手动操作后重新签名并同步.

## 客户端使用

```bash
curl -fsSL https://<your-domain>/install.sh | sudo bash
sudo apt update && sudo apt install myapp
```

`/uninstall.sh` (symmetric counterpart of `install.sh`, also served as plain text):

```bash
curl -fsSL https://<your-domain>/uninstall.sh | sudo bash
# 可选: 同时卸载从此仓库装的包
curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=myapp bash
curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=all bash
```

## 迁移到新机器

打包整个 `~/cloud-apt/` (keys, conf, db, pool, dists) 成可迁移压缩包, 在新机器导入:

```bash
# 旧机器: 导出
./local-repo/scripts/migrate-export.sh
# → 默认输出 ~/cloud-apt/cloud-apt-export-<UTC时间戳>.tar.gz
#   SHA256 在终端打印, 传输后可对比

# 新机器: 导入 (假设 ~/cloud-apt 还没有)
./local-repo/scripts/migrate-import.sh /path/to/cloud-apt-export-<ts>.tar.gz
# → 自动校验 magic (CLOUD-APT-EXPORT-V1)
#   若目标目录已存在, 自动备份为 <target>.bak.<ts>
#   还原 keys/ 700, private.key.gpg/keyid.txt 600
```

**导入包识别**: 包内顶部固定含 `EXPORT-MANIFEST.json`, 第一行 `"magic": "CLOUD-APT-EXPORT-V1"`. 任何 magic 不匹配的 `.tar.gz` 都会被拒绝.

**体积优化**: `INCLUDE_DISTS=0 ./migrate-export.sh` 不打包 `dists/`, 导入后 `reprepro export` 重新签名 (GPG key 一致, 签名结果字节级相同).

**安全提示**:
- 包内私钥 (`keys/private.key.gpg`) 仍是 passphrase 加密的, 务必保管好 passphrase
- 传输用加密通道 (scp, encrypted USB, password manager 附件)
- 导入后建议立即验证 GPG: `gpg --list-secret-keys <email>`

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

### Cloudflare 构建报 `apt-worker/dist does not exist`

Cloudflare Dashboard 的 Build command 必须**留空**, 让 `wrangler.toml` 的 `[build]` 段执行前端构建。如果填了 `npm run build` 等命令, 会和 `[build]` 段冲突, `apt-worker/dist` 不会被创建。

## 附录: 轮换 ADMIN_PUSH_TOKEN (泄露时)

如果怀疑 `ADMIN_PUSH_TOKEN` 泄露 (例如 push 日志被截获、CI runner 被入侵、token 误提交到公开仓库), 立即轮换:

1. **Cloudflare Dashboard**: Workers & Pages → 选中 `cloud-apt-worker` → Settings → Variables and Secrets
2. 找到 `ADMIN_PUSH_TOKEN` 条目 → 点击 "Edit" → 修改为新值 → "Save"
3. Dashboard 自动触发重新部署, 几秒内生效, **旧 token 立即失效**
4. **本地**: 更新 `local-repo/config.env` 中的 `ADMIN_PUSH_TOKEN=新值`
5. 重新执行 `push-key.sh` 和 `build-and-push.sh`, 让本地重新认证

> **R2 对象不受影响** — token 只是传输层鉴权, 不参与 R2 状态。R2 中的 `.deb`、`Packages`、`Release` 文件会保留。GPG 私钥如果未泄露则不需要重生成, 重生成会导致所有客户端需要重新下载公钥 (`apt-key` 提示未签名直到下次 `apt update`)。

## 附录: 安全建议清单 (运营期)

| 项 | 频率 | 说明 |
|---|---|---|
| 检查 Cloudflare Access 日志 | 每周 | Dashboard → Workers → Logs → 过滤 `/api/upload/*` 异常 IP |
| 轮换 ADMIN_PUSH_TOKEN | 每 90 天 | 同上流程 |
| 备份 reprepro 仓库 + GPG 私钥 | 每周 | 离线加密备份 (GPG 私钥本身已 AES256) |
| 检查 R2 存储用量 | 每月 | Dashboard → R2 → `cloud-apt` → Metrics, 异常增长 = 异常写入 |
| 更新 Worker 依赖 | 每月 | `npm outdated --workspace apt-worker` |