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