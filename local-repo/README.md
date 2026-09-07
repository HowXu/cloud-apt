# local-repo

cloud-apt 的本地仓库工具。Fork 后只需两个公开命令即可使用:

```bash
./local-repo/scripts/init.sh        # 首次: 写配置 + 准备 GPG + 推送公钥/客户端脚本
./local-repo/scripts/push.sh pkg.deb # 日常: 签名 + 推送 .deb
```

## 工具要求

- reprepro (`apt install reprepro`)
- GPG 2.x (`apt install gnupg2`)
- curl (`apt install curl`)
- podman (可选, 容器化构建)

## 配置文件

`init.sh` 会把 Worker URL 与上传 Token 保存到 `local-repo/config.env` (权限 600)。
GPG passphrase 不写入任何文件, 由 `push.sh` 临时提示输入。

CI 环境可直接放置 `local-repo/config.env`:

```bash
WORKER_URL="https://apt.example.com"
ADMIN_PUSH_TOKEN="..."
```

## 高级入口

`build-and-push.sh --remove <pkg>` 与 `--sync` 仍保留, 适合高级维护。
迁移用 `migrate-export.sh` / `migrate-import.sh`。

## 自定义 REPO_ROOT

```bash
export CLOUD_APT_ROOT=/custom/path
./local-repo/scripts/init.sh
```

不建议把状态放 `$HOME`, 因为 git 仓库里的状态 + 用户本地的密钥 应该物理隔离。
