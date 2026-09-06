# local-repo

本地仓库状态 + 工具脚本, 全部位于项目内 `local-repo/`, **不污染 `$HOME`**.

```
local-repo/
├── README.md
├── conf/
│   ├── distributions.template    # 模板 (git 跟踪, 含 __GPG_EMAIL__ 占位符)
│   └── distributions            # live 副本 (gitignore, gen-key.sh 会替换 SignWith)
├── scripts/                     # 模板 + 实时入口 (git 跟踪)
│   ├── setup-reprepro.sh
│   ├── gen-key.sh
│   ├── push-key.sh
│   ├── push-install.sh
│   ├── build-and-push.sh
│   ├── migrate-export.sh
│   ├── migrate-import.sh
│   └── install.sh               # 推送到 Worker 的客户端脚本模板
├── dockerfiles/                 # (git 跟踪)
├── keys/                        # GPG 私钥 (gitignore, chmod 700)
├── db/                          # reprepro SQLite (gitignore)
├── pool/                        # 上传的 .deb (gitignore)
├── dists/                       # 签名的 Release/Packages (gitignore)
└── incoming/                    # 临时入站 (gitignore)
```

## 工具要求

- reprepro (`apt install reprepro`)
- GPG 2.x (`apt install gnupg2`)
- curl (`apt install curl`)
- podman (可选, 容器化构建)

## 使用

参见项目根 README.md 的"本地初始化"和"推送 .deb 包"章节.

## 自定义 REPO_ROOT

所有脚本默认 `REPO_ROOT = local-repo/` (脚本所在目录的父目录).
用环境变量覆盖:

```bash
export CLOUD_APT_ROOT=/custom/path
./local-repo/scripts/setup-reprepro.sh
```

不建议把状态放 `$HOME`, 原因是 git 仓库里的状态 + 用户本地的密钥 应该物理隔离 — 即使误 `git add -A` 也不会把私钥传上去.

## 迁移

跨机器迁移仓库状态 (含 GPG 私钥) 用 `migrate-export.sh` + `migrate-import.sh`,
识别标志是包顶部 `EXPORT-MANIFEST.json` 的 `magic: "CLOUD-APT-EXPORT-V1"`.