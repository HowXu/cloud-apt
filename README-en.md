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
├── apt-worker/          # Cloudflare Worker backend (TypeScript)
├── apt-client/          # Vue 3 frontend (build output deployed to apt-worker/dist)
├── local-repo/          # Local repo template (deployed to ~/cloud-apt/)
│   ├── scripts/         # Publish/migrate/init: thin bash wrappers + Python core
│   │   ├── init.sh / push.sh / build-and-push.sh
│   │   ├── migrate-export.sh / migrate-import.sh
│   │   ├── push-key.sh / push-install.sh / gen-key.sh
│   │   ├── publish.py    # core: snapshot, upload by-hash, signed commit
│   │   ├── migrate.py    # core: export/import + GPG-encrypt config.env
│   │   ├── repo_state.py # shared: GPG home, repo lock, SHA256
│   │   └── lib-*.sh      # bash common (config + UI)
│   ├── conf/            # reprepro distributions (created at runtime)
│   ├── keys/            # GPG key pair (gitignored)
│   └── ...              # db/ pool/ dists/ incoming/ created at runtime
├── example/             # Sample .deb packages for end-to-end testing
│   ├── build.sh         # Builds every example (cloud-apt-hello + cloud-apt-info)
│   ├── cloud-apt-hello/ # C, libc6
│   └── cloud-apt-info/  # Python, python3
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

Full deployment, troubleshooting, token rotation, and security appendix: [docs/DEPLOY.md](docs/DEPLOY.md).

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

## Backup & Restore

For migration, cross-machine moves, or disaster recovery, use these two scripts. The resulting tar.gz is **fully restorable** — the top-level `EXPORT-MANIFEST.json` validates magic and per-file SHA256, and **`config.env` is encrypted with the repo's own GPG public key** (you'll see `config.env.gpg` in the tarball, not plaintext).

### Exporting repo state

```bash
./local-repo/scripts/migrate-export.sh /safe/path/cloud-apt-export-$(date +%Y%m%d).tar.gz
```

Bundles:
- `keys/` (encrypted private key + public key + `keyid.txt`)
- `conf/` (reprepro config)
- `db/` (reprepro database)
- `pool/` (package files)
- `dists/` (indexes + signatures)
- `config.env.gpg` (`config.env` encrypted with `keys/public.key`)

**Does not include** `.publish/` (publication staging) or the scripts themselves.

### Importing

```bash
./local-repo/scripts/migrate-import.sh /path/to/cloud-apt-export-XXX.tar.gz
./local-repo/scripts/push.sh path/to/package.deb
```

The import script automatically:
- Decrypts `config.env.gpg` with the GPG private key (the passphrase you entered during import) into `local-repo/config.env`
- Replaces the state subdirectories
- If `dists/` is non-empty, runs `./local-repo/scripts/build-and-push.sh --sync kali-rolling` automatically (a failure is just a warning)

**No need to run `init.sh`**, and **no need to invoke `--sync` manually**.

### Full cross-machine migration

1. **Source machine**: `migrate-export.sh`; copy the tar.gz to a USB drive or remote storage
2. **Target machine**: clone this git repo
3. **Target machine**: `migrate-import.sh` to extract the tar.gz
   - The script **interactively prompts** for the GPG passphrase (to unlock `keys/private.key.gpg`); the same passphrase decrypts `config.env.gpg` automatically
4. **Target machine**: run `./local-repo/scripts/push.sh path/to/package.deb` directly

> If the source machine's GPG private key has been deleted from the keyring (see `gen-key.sh` docs) but `keys/private.key.gpg` is still present, `migrate-import.sh` still works — symmetric encryption depends only on the passphrase, not on the keyring's private key.

## Development

Publishing and migration require Linux, Python 3.10+, reprepro and GnuPG. Deploy the updated Worker before using the updated scripts. Publications are saved locally, uploaded with SHA256 verification, and activated through a conditional R2 pointer update. Failed uploads can be resumed with `build-and-push.sh --resume [suite]`; `--sync [suite]` builds and verifies a fresh full publication. Old by-hash indexes and packages are retained for clients using earlier signed metadata.

Migration restores state directories only, preserving installed scripts and local connection settings. It validates the archive and tests the encrypted signing key in an isolated GPG keyring before replacing state. Run Linux integration tests with `python3 -m unittest discover -s local-repo/test -v`; they use temporary repositories and APT state, without installing system packages.

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

Audit notes live in the repository's `docs/` directory at specific commits:
- v1: <https://github.com/<you>/cloud-apt/blob/5fb037a/docs/SECURITY-AUDIT.md>
- v2: <https://github.com/<you>/cloud-apt/blob/d05e437/docs/SECURITY-AUDIT-2.md>
- v3: <https://github.com/<you>/cloud-apt/blob/0314f08/docs/SECURITY-AUDIT-3.md>

## License

MIT
