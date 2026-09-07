<p align="center">
    <h1 align="center">Cloud-APT</h1>
    <p align="center">A lightweight private APT repository on Cloudflare Workers — one-click deploy 🎉</p>
    <p align="center">
        <a href="./README.md">中文</a>
    </p>
</p>

## Introduction

Deploy a private APT repository with a browse UI using a single Cloudflare Worker. Supports local GPG signing via reprepro and curl-based push; apt clients (`apt update && apt install`) work out of the box.

Architectural pattern inspired by [cloud-maven](https://github.com/HowXu/cloud-maven) (Worker + Vue SPA + R2).

## Features

- **One-click deploy** — Fork the repo, import via the Cloudflare Dashboard, no servers to manage
- **GPG signing** — Local reprepro signing; apt client strong verification passes
- **Vue 3 browse UI** — package list, details, and search
- **R2 object storage** — deb files + apt metadata pushed straight to R2, 0 egress fees
- **Worker push API** — `PUT /api/upload/{path}` with bearer token authentication
- **Multi-arch** — Supports `amd64` + `arm64`

## Showcase

After deployment, visit `https://<your-worker-domain>/`:

- **Home**: suite list + search box
- **Package list**: `/browse?suite=kali-rolling&arch=amd64`
- **Package details**: `/browse/<package-name>`
- **Search**: `/search?q=<query>`

(TODO: Screenshots)

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Backend framework**: Hono
- **Frontend**: Vue 3 + TypeScript + Vite + UnoCSS
- **Storage**: Cloudflare R2 (deb + metadata) + Workers KV (index cache)
- **Security**: Bearer Token (wrangler secret), R2 private, GPG signing
- **Local**: reprepro + GPG (ed25519) + podman + curl

## Directory Structure

```
cloud-apt
├── apt-worker/          # Cloudflare Worker backend
├── apt-client/          # Vue 3 frontend (build output deployed to apt-worker/dist)
├── local-repo/          # Local repo template (deployed to ~/cloud-apt/)
└── docs/                # spec + plan
```

## Deployment Guide

### 1. Prepare Cloudflare Resources

Fork this repository to your GitHub account.

### 2. Import from Git

Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Create Worker** → **Connect to Git** → Select the forked repository.

Advanced settings:
- **Root directory**: `apt-worker`
- **Build command**: Leave empty (the `[build]` config in `wrangler.toml` is used)

### 3. Bind Resources

Cloudflare auto-detects `wrangler.toml` and will prompt you to bind a KV namespace and an R2 bucket. **Accept the defaults** (Cloudflare creates them automatically).

If you need to customize:
- KV namespace: name it `cloud-apt-kv`, copy the ID into `wrangler.toml`
- R2 bucket: name it `cloud-apt`

### 4. Set the Push Token

Worker → **Settings** → **Variables and Secrets** → **Add Secret**:

```
Name: ADMIN_PUSH_TOKEN
Value: <a strong secret, e.g.: openssl rand -hex 32>
```

### 5. Redeploy

Back in the Worker → **Deployments** → trigger a redeploy (e.g. push an empty commit).

### 6. Bind a Custom Domain (optional)

Worker → **Triggers** → **Custom Domains** → add `apt.example.com`.

DNS auto-configures CNAME → Worker.

## Local Initialization

```bash
git clone https://github.com/<you>/cloud-apt
cd cloud-apt
./local-repo/scripts/init.sh
```

`init.sh` prompts for the Worker URL, push token, and GPG passphrase, then provisions the local repo structure, GPG key, and uploads the public key plus the client install script.

## Pushing .deb Packages

```bash
./local-repo/scripts/push.sh ../myapp_1.0_amd64.deb
```

`push.sh` prompts for the GPG passphrase, signs locally, regenerates the index, and uploads only the changed files.

## Client Usage

```bash
curl -fsSL https://apt.example.com/install.sh | sudo bash
sudo apt update && sudo apt install myapp
```

## Development

```bash
# Local development (Worker + ASSETS binding serves the frontend automatically)
cd apt-worker
npm run dev

# Test
npm test

# Build
npm run build
```

## Spec

`docs/superpowers/specs/2026-09-02-cloud-apt-repository-design.md`

## Security Audits

- v1: [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)
- v2: [docs/SECURITY-AUDIT-2.md](docs/SECURITY-AUDIT-2.md)

## License

MIT