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
- Python 3.10+ (`apt install python3`，发布与迁移使用标准库，无 pip 依赖)
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

## 发布、重试与版本一致性

升级时先部署新版 Worker，再更新本地脚本。第一次用新版脚本发布前，Worker 继续读取原有 `dists/` 文件；首次成功发布后，浏览 API 和 APT 都读取已提交快照。此后不要再用旧版脚本覆盖 `dists/`，它不会切换当前快照。

发布器对整次收包、签名、上传加本地排他锁，将选定 suite 引用的 `.deb`、索引和签名复制到 `.publish/`。每个文件发送 SHA256，Worker 校验并确认后才记录完成。最后 `/api/publish/<suite>` 校验整个清单中的远端对象，再通过 R2 条件写入一次性切换当前版本；另一台维护机抢先发布时返回冲突，不覆盖对方的新版本。

```bash
# 网络失败：重试原命令，或仅恢复已保存的同一批快照（无需原 deb）
./local-repo/scripts/build-and-push.sh --resume kali-rolling

# 远端被手动改动、发布冲突，或要将当前本地仓库作为完整目标重新同步
./local-repo/scripts/build-and-push.sh --sync kali-rolling
```

`--sync` 会创建新快照、重新上传校验全部引用文件，并以执行开始时的远端版本作为提交前提；它不会自动合并其他维护机的包。它也可以替代未完成的发布，未引用的本地旧暂存目录可在确认不再恢复后清理。

Release 使用 SHA256 并声明 `Acquire-By-Hash: yes`。包文件、快照和旧 by-hash 索引在远端保持不可变，读取旧 InRelease 的客户端仍可取得对应旧索引和包；可变的规范索引 URL 不缓存。包内容变更必须使用新版本/文件名。下架仅从新索引中移除，旧文件暂不做自动回收，避免破坏进行中的下载。

要求客户端支持 InRelease 和 by-hash（现代 Debian/Ubuntu/Kali APT）。禁用 by-hash 或仅使用分离签名的旧客户端仍可能跨两个请求遇到发布切换，应重新执行 `apt update`。

## 迁移与恢复

```bash
./local-repo/scripts/migrate-export.sh /safe/path/repository.tar.gz
./local-repo/scripts/migrate-import.sh /safe/path/repository.tar.gz /new/repository
export CLOUD_APT_ROOT=/new/repository
./local-repo/scripts/build-and-push.sh --sync kali-rolling
```

导出仅包括 `keys/conf/db/pool/dists` 状态，不包含 Token 配置、发布暂存或脚本。V2 备份记录每个文件的 SHA256，继续支持导入 V1；`INCLUDE_DISTS=0` 可省略索引，恢复后通过 `--sync` 重新生成。

导入先在目标目录旁完整解包，拒绝路径穿越、链接、特殊文件和重复条目；验证清单、密钥指纹、解密私钥、签名自检及 reprepro 数据库引用后，才替换状态子目录。备份放在目标目录内也可正常恢复。脚本、Dockerfile、本机配置和现有模板保留；旧状态及旧发布暂存保存到 `<target>.bak.<唯一标识>`。替换过程中发生可捕获错误会回滚，掉电或 SIGKILL 时应保留该备份人工恢复。

发布与迁移均使用临时隔离 GPG keyring，从加密备份恢复指定私钥，不依赖新机器的用户 keyring，不将私钥导入全局 keyring。密码通过 stdin 传给 GPG，退出时销毁临时 agent。恢复后需重新配置 Worker URL/Token。

## 回归测试（Linux）

```bash
sudo apt-get install reprepro gnupg python3
python3 -m unittest discover -s local-repo/test -v
```

测试使用临时密钥、仓库和 APT 状态目录，覆盖断线恢复、提交响应丢失、并发锁、全量补传、升级/下架、迁移回滚，以及真实 APT 的签名验证与软件下载，不修改系统软件源或安装系统包。

## 自定义 REPO_ROOT

```bash
export CLOUD_APT_ROOT=/custom/path
./local-repo/scripts/init.sh
```

不建议把状态放 `$HOME`, 因为 git 仓库里的状态 + 用户本地的密钥 应该物理隔离。
