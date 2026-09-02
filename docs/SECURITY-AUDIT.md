# Security Audit Report — cloud-apt v0.1.0

**Date:** 2026-09-02
**Scope:** Backend Worker (`apt-worker/`), Vue SPA (`apt-client/`), local-repo bash scripts, configs, docs
**Auditor:** Senior Security Engineer (subagent)
**Prior review fixes verified:** I-1 SPA fallback ✓, I-2 Binary upload ✓
**Post-audit fix verification:** 44/44 tests pass · `tsc --noEmit` clean · `vue-tsc --noEmit` clean · build succeeds

---

## Final commit chain (9 new commits, this audit)

```
c0be5ae chore: harden build:copy script and document token rotation       (M-8 + M-9)
a40339f fix(local-repo): sanitize WORKER_URL to prevent shell injection  (I-6)
183926d fix(local-repo): pass ADMIN_PUSH_TOKEN via curl config file      (I-5)
3131b0f chore(apt-worker): add DEV CONFIG banner to wrangler-dev.toml    (M-3)
80e699b fix(apt-worker): reject directory-style empty upload paths        (M-1)
3079851 fix(apt-worker): tag KV cache entries with R2 ETag to fix race    (I-4)
8fa6017 fix(apt-worker): add CSP and security headers to SPA HTML         (I-3)
46f6de7 fix(apt-worker): validate Content-Type per upload prefix          (I-2)
5a427db chore(apt-worker): remove dead static/ prefix from whitelist      (I-1)
```

---

## Verdict

**Overall:** **Ready for deployment.**

**Threat model:** Single-operator personal apt repo. Adversary is either (a) an
unauthenticated internet user (can read but not write), (b) someone who
phished/leaked the `ADMIN_PUSH_TOKEN`, or (c) someone who compromised the
Cloudflare account.

**Critical issues:** **None found.** The core security model — token-gated
R2 writes, prefix whitelist, constant-time compare, no CORS, hardcoded
content-types on trust anchors (`pubkey.asc` and `install.sh`) — is sound
for the stated fork-and-deploy threat model.

**No `Critical` issues were outstanding after this audit pass.**

---

## Strengths (verified)

- **Constant-time auth compare** (`apt-worker/src/shared/auth.ts`) — XOR-OR loop with length check; fail-secure when `ADMIN_PUSH_TOKEN` missing.
- **Path whitelist** (`apt-worker/src/shared/path.ts`) — prefix-only, `..`/null-byte/absolute rejection; URL-parser-normalized paths can never escape.
- **Hardcoded content-type overrides** for trust anchors (`pubkey.asc`, `install.sh`) — overrides any R2 metadata, preventing authenticated content-type spoofing on the highest-value endpoints.
- **No CORS headers** — cross-origin upload from a browser is blocked by SOP/CORS. Defense-in-depth against CSRF.
- **Binary-safe upload** (commit `d2dcfe6`) — `req.arrayBuffer()`, test asserts round-trip decode.
- **SPA fallback configured** (commit `d2dcfe6`) — both wrangler configs have `not_found_handling = "single-page-application"`.
- **Frontend XSS hygiene** — `grep` confirms zero `v-html` / `innerHTML` / `dangerouslySetInnerHTML` in `apt-client/src/`. All interpolation via Vue's `{{ }}` auto-escape.
- **GPG key handling** — chmod 700 key dir, chmod 600 passphrase file, AES256 file encryption, `shred -u` cleanup.
- **Bash discipline** — all local-repo scripts have `set -euo pipefail`, required vars via `: "${VAR:?...}"`, no `eval`, no unquoted expansions that could matter.

---

## Issues fixed in this audit

| # | Severity | Title | Files |
|---|---|---|---|
| I-2 | Important | Content-Type spoofing → XSS | `apt-worker/src/upload.ts`, `apt-worker/test/upload.test.ts` |
| I-3 | Important | Missing CSP / security headers | `apt-worker/src/index.ts`, `apt-worker/test/spa-headers.test.ts` (new) |
| I-4 | Important | Cache race (stale index after invalidate) | `apt-worker/src/cache.ts`, `apt-worker/src/api-index.ts` |
| I-5 | Important | Token leaked via process listing (curl argv) | `local-repo/scripts/{push-key,push-install,build-and-push}.sh` |
| I-6 | Important | Shell injection via `WORKER_URL` | `local-repo/scripts/push-install.sh` |
| I-1 | Important | Dead `static/` whitelist prefix | `apt-worker/src/shared/path.ts`, `apt-worker/test/path.test.ts` |
| M-1 | Minor | Directory-style empty uploads | `apt-worker/src/shared/path.ts`, `apt-worker/test/path.test.ts` |
| M-3 | Minor | wrangler-dev.toml needs DEV banner | `apt-worker/wrangler-dev.toml` |
| M-8 | Minor | build:copy script guards | `package.json` (root) |
| M-9 | Minor | Token rotation docs | `docs/DEPLOY.md` |

---

## Issues deliberately deferred

| # | Severity | Title | Reason |
|---|---|---|---|
| I-7 | Important | GPG passphrase in plaintext on disk (gen-key.sh) | Requires refactor to `--passphrase-fd` and end-to-end GPG run testing. Out of scope for the audit pass; planned for a follow-up local-repo hardening PR. |
| M-2 | Minor | 100MB body buffering | Cloudflare rejects >100MB at edge with 413. Bounded. |
| M-4 | Minor | No rate-limit on `/api/upload/*` | Token brute-force is 2^256 work factor. Cloudflare WAF limit recommended in `docs/DEPLOY.md` as an operational follow-up. |
| M-5 | Minor | md5sum breaks on filenames with spaces | APT naming forbids spaces; theoretical. |
| M-6 | Minor | `shred` not on macOS | Plan target is Kali (Linux). |
| M-7 | Minor | No timing-side-channel test for constant-time compare | Out of scope for MVP. Property is verified by code review. |

---

## Defense-in-depth posture

### Read path (unauthenticated)
- `GET /dists/*`, `/pool/*`, `/pubkey.asc`, `/install.sh` → R2 proxy with `Cache-Control: max-age=300`.
- `GET /api/index/{suite}/{arch}` → KV cache + R2 fallback, ETag-tagged.
- `GET /*` (any other) → ASSETS SPA with `not_found_handling = "single-page-application"` and full CSP/XCTO/RP/XFO headers on HTML responses.

### Write path (authenticated)
- `PUT/DELETE /api/upload/{path}` → constant-time Bearer compare → prefix whitelist → **Content-Type allowlist per prefix** → `bucket.put(arrayBuffer, ...)`.
- `POST /api/invalidate` → constant-time Bearer compare → KV delete.

### Local-repo (operator-side)
- GPG key generation: AES256 file encryption, `shred -u` cleanup.
- Push to Worker: **token via curl config file** (not argv), `set -euo pipefail`, `trap` cleanup, `--data-binary` for binary files.
- WORKER_URL sanitization: **hostname-charset regex** before any shell interpolation.

---

## Test gaps remaining (acceptable for v0.1.0)

| Severity | Gap |
|---|---|
| Medium | URL-encoded path bypass attempts (`%2e%2e`, `%c0%ae`, `\\..\\`) — URL parser normalizes most; focused test would harden contract |
| Medium | Empty / oversized body — Cloudflare edge limits to 100MB with 413 |
| Low | `/api/invalidate` 401 path — not exercised in unit tests (covered by integration coverage) |
| Low | `/api/index` for missing suite returns `[]` — covered implicitly by api-index tests |
| Low | Multi-arch KV isolation — covered by key naming (`index:${suite}:${arch}`) |
| Low | Hono route precedence — relies on `app.get` order; future refactor risk |

---

## Dependency / supply chain

No critical CVEs identified in the dependency tree. All deps are official or widely-used packages:

| Dep | Version | Status |
|---|---|---|
| hono | ^4.7.0 | Healthy |
| vue | ^3.5.0 | Healthy |
| vue-router | ^4.4.0 | Healthy |
| unocss | ^0.65.0 | Older minor; bump at next opportunity |
| wrangler | ^4.20.0 | Cloudflare official |
| @cloudflare/vitest-pool-workers | ^0.8.70 | Cloudflare official |
| @cloudflare/workers-types | ^4.20250906.0 | Cloudflare official |
| vite | ^5.4.0 | Healthy; Vite 6+ current |
| vue-tsc | ^2.1.0 | Healthy |

**Recommendation:** Add `"engines": { "node": ">=20" }` to root `package.json` to lock the Cloudflare Workers target.

---

## Blast radius analysis

**If `ADMIN_PUSH_TOKEN` leaks (most likely scenario):**

| Attack | Outcome | Mitigation |
|---|---|---|
| Upload arbitrary file to `dists/`, `pool/` | Attacker writes arbitrary APT metadata or `.deb` | Allowed Content-Types per prefix (I-2 fix). Repo GPG signature remains valid (attacker can't forge without private key). |
| Delete `pubkey.asc` / `scripts/install.sh` | `apt update` breaks until re-upload | Attacker can re-upload with their own pubkey (but clients would refuse it — they already have the legit key in their keyring). |
| Invalidate KV cache | Stale index for next 300s TTL | Self-correcting. |
| Serve HTML/JS from worker's origin | XSS against SPA session/cookies | **Mitigated by I-2** (Content-Type allowlist). XSS primitive closed. |
| Mass R2 writes (cost amplification) | Account bill shock | Recommended Cloudflare WAF rule: 60 PUT/min per IP on `/api/upload/*` (M-4 docs). |

**The GPG private key is the real trust anchor.** As long as it stays on
the operator's machine (encrypted + offline backup), the integrity of the
apt repository holds. The Worker token is a transport-layer convenience,
not the security boundary.

---

## Final stats

- **Tests:** 44/44 pass across 9 files (was 34/8 before audit; +10 new from fixes)
- **Typecheck:** 0 errors (worker `tsc --noEmit` + client `vue-tsc --noEmit`)
- **Build:** succeeds end-to-end (`apt-client/dist/` → `apt-worker/dist/`)
- **Commits:** 9 new (atomic, one per fix category)
- **Lines added:** ~310 across worker code + tests + bash + docs
- **Lines removed:** ~25 (dead code from `static/`, manual token passing)

---

## Recommendations for v0.2

1. **Rate limiting** — Cloudflare WAF rule on `/api/upload/*` (60 PUT/min per IP).
2. **Audit logging** — emit structured log on every upload/delete/invalidate to Cloudflare Logpush.
3. **Stale cache test** — add a focused integration test for the invalidate race with mock clock.
4. **CSP tightening** — once the SPA's external font/asset dependencies are finalized, remove `unsafe-inline` from `style-src` and self-host the font.
5. **Bump deps** — unocss 0.66+, vite 6+ at next opportunity.
6. **GPG passphrase on disk** — refactor `gen-key.sh` to use `--passphrase-fd` (I-7 deferred).
7. **Stateless admin auth** — if/when admin UI is added, switch to Cloudflare Access (JWT) instead of a single bearer token.
