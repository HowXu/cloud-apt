# Cloud APT — Security Audit v2 (2026-09-06)

**Scope**: full second-pass review covering everything new since v1 audit (commit `c0be5ae`) plus any v1 findings not yet addressed.

**Method**: 4 parallel static reviews by subagent (Worker core, deploy & config, local-repo scripts, example deb + client install), followed by a fix pass for in-scope items.

**Verdict**: **0 Critical**, **3 Important** (1 fixed in this branch, 2 deferred), **22 Minor** (10 fixed in this branch, 12 deferred).

## Findings — Important

- **I-1: `vite ^5.4.0` carries high-severity path-traversal CVE (GHSA-fx2h-pf6j-xcff, CVSS 7.5).** — `apt-client/package.json:22`. Fix requires Vite 8 (semver-major). **Deferred** — major version bumps are out of scope for this branch (see `docs/superpowers/specs/2026-09-06-chore-and-security-audit-v2-design.md` Global Constraints).
- **I-2: `gen-key.sh` writes GPG passphrase to disk in `$KEY_DIR/gpg-gen-key.conf`.** — `local-repo/scripts/gen-key.sh:51`. Heredoc-writes `Passphrase: $GPG_PASSPHRASE` before `gpg --gen-key` reads it. `chmod 600` narrows but does not eliminate the window. **Deferred** — same as v1 I-7; refactor to `--passphrase-fd 3` is non-trivial and not on the production-critical path (only runs at one-time key generation).
- **I-3: `gen-key.sh` missing EXIT trap for `private.key` + `gpg-gen-key.conf`.** — `local-repo/scripts/gen-key.sh:86` (pre-fix). If script interrupted (Ctrl+C, SIGTERM, set -e failure), unencrypted `private.key` and the passphrase-bearing config file persist on disk. **Fixed** in commit `1c6ba5e` — added `trap 'shred -u ...; unset GPG_PASSPHRASE' EXIT` after `mkdir -p "$KEY_DIR"`.

## Findings — Minor

### Fixed in this branch

- **M-1: `proxy.ts` missing `X-Content-Type-Options: nosniff` on R2-proxied responses.** — `apt-worker/src/proxy.ts:17`. **Fixed** in `dd89b66`. Operator-side R2 object with stored Content-Type `text/html` would have rendered without a nosniff guard.
- **M-2: `index.ts` SPA CSP missing `frame-ancestors 'none'`.** — `apt-worker/src/index.ts:52`. **Fixed** in `dd89b66`. `X-Frame-Options: DENY` was set but the modern CSP directive was missing.
- **M-3: `wrangler-dev.toml` had hardcoded `ADMIN_PUSH_TOKEN = "dev-token-1234"` under `[vars]`.** — `apt-worker/wrangler-dev.toml:38`. **Fixed** in `dd89b66`. Moved to `apt-worker/.dev.vars` (chmod 600, gitignored).
- **M-4: `gen-key.sh` unnecessarily exported `GPG_PASSPHRASE` into process environment.** — `local-repo/scripts/gen-key.sh:46`. **Fixed** in `1c6ba5e`. Visible to any local user via `/proc/<pid>/environ`.
- **M-5: `build-and-push.sh` EXIT trap did not unset `GPG_PASSPHRASE`.** — `local-repo/scripts/build-and-push.sh:44`. **Fixed** in `1c6ba5e`. Mid-loop `exit 1` would have left passphrase in process env until shell exit.
- **M-6: `install.sh` did not validate `CLOUD_APT_SUITE` before interpolating into deb822 sources.** — `local-repo/scripts/install.sh:11`. **Fixed** in `1c6ba5e`. Now validates against `^[a-z0-9][a-z0-9.+~-]*$`.
- **M-7: `push-install.sh` and `push-key.sh` did not enforce `WORKER_URL` starts with `https://`.** — `local-repo/scripts/push-install.sh:6`, `local-repo/scripts/push-key.sh:7`. **Fixed** in `1c6ba5e`. Without this guard, `WORKER_URL=http://attacker.example` would transmit `Authorization: Bearer <token>` in cleartext.
- **M-8: `uninstall.sh` CLOUD_APT_PURGE=all had no confirmation.** — `local-repo/scripts/uninstall.sh:34`. **Fixed** in `1c6ba5e`. Now prompts with `[y/N]` unless `YES=1`.
- **M-9: `.gitignore` broken by inline `# comments` after patterns.** — `.gitignore:14-19` (pre-fix). **Fixed** in `f568a4d` (Task 5 hygiene). Inline comments had broken 5 `local-repo/*` patterns.
- **M-10: `dev-token-1234` is the same literal in `wrangler-dev.toml` (pre-fix) and `apt-worker/.dev.vars`.** — `apt-worker/.dev.vars`. **Fixed** in `dd89b66`. Now `.dev.vars` is the single source of truth; `wrangler dev` reads it automatically.

### Deferred (non-blocking)

- **M-11: `gen-key.sh --passphrase` argv exposure during AES256 re-encryption of private.key.** — `local-repo/scripts/gen-key.sh:81`. Visible briefly to `ps -e` / procfs while `gpg` runs. Local-only, short-lived. **Deferred** — refactor to `--passphrase-fd 3` pairs with I-2; not worth splitting.
- **M-12: `gen-key.sh` no passphrase length validation.** — `local-repo/scripts/gen-key.sh:14`. A 1-character passphrase is accepted. **Deferred** — UX/correctness, not security exploitable in any way beyond the user's own key strength.
- **M-13: `gen-key.sh` non-atomic file writes (`cat >` / `gpg --export >`).** — `local-repo/scripts/gen-key.sh:75,78,91`. SIGKILL mid-write truncates the file. **Deferred** — refactor to `tmpfile + mv` is cleanup; the gen-key workflow is one-shot and operator-supervised.
- **M-14: `build-and-push.sh` unquoted `$f` in `for f in $TO_UPLOAD` loop.** — `local-repo/scripts/build-and-push.sh:104`. APT filename charset forbids whitespace, so theoretical only. **Deferred** — cosmetic hardening.
- **M-15: `local-repo/scripts/setup-repropro.sh` is a byte-for-byte duplicate of `setup-reprepro.sh`** (typo). — Two parallel entry points, risk of divergence. **Deferred** — operator can delete the typo'd copy; documented for the next chore branch.
- **M-16: `migrate-export.sh` JSON injection via `hostname` / `whoami` into `EXPORT-MANIFEST.json`.** — `local-repo/scripts/migrate-export.sh:67`. Malformed JSON if hostname contains `"`, `\`, or newline. **Deferred** — magic-header verification on import side is unaffected.
- **M-17: `uninstall.sh` unquoted `$PKGS` in `sudo apt purge -y $PKGS` (non-all branch).** — `local-repo/scripts/uninstall.sh:34`. **Deferred** — same as M-14 (the array branch correctly uses `"${PKGS[@]}"`).
- **M-18: `Dockerfile.kali-rolling` uses floating `latest` tag.** — `local-repo/Dockerfile.kali-rolling:1`. Supply-chain risk if upstream image is replaced. **Deferred** — image is build-only; pin to digest is a one-line change for the next chore.
- **M-19: `install.sh` CLOUD_APT_SUITE heredoc delimiter not quoted.** — `local-repo/scripts/install.sh:24`. Cosmetic. **Deferred** — validation now in place (M-6); heredoc quoting is belt-and-suspenders.
- **M-20: `uninstall.sh` does not run `apt-get clean` after keyring removal.** — `local-repo/scripts/uninstall.sh:65`. Downloaded `.deb` files remain in `/var/cache/apt/archives/`. **Deferred** — privacy hardening, not security.
- **M-21: `push-install.sh` does not validate `WORKER_URL` domain against regex (push-key.sh has the same gap).** — `local-repo/scripts/push-install.sh:33`, `local-repo/scripts/push-key.sh:23`. **Deferred** — https guard added (M-7) closes the most critical vector; regex validation is layering.
- **M-22: `example/debian/postinst` hardcodes `PREFIX=/opt/cloud-apt-hello-0.2.0`.** — `example/debian/postinst:4`. If Makefile/control are bumped without updating postinst, the symlink is dangling. **Deferred** — example-only; the binary's `--version` is the source of truth.

## Cross-references to v1

- See `docs/SECURITY-AUDIT.md` (commit `c0be5ae`).
- All v1 Important (I-1 through I-6) remain fixed.
- v1 Minor (M-1, M-3, M-8, M-9) remain fixed.
- v1 Minor M-2, M-4, M-5, M-6, M-7 — out of scope per v1 notes (admin/UX hardening unrelated to security).
- v1 Important I-7 (gen-key.sh passphrase on disk) — re-raised as I-2 above, still deferred.

## Resolved since v1

- v1 I-1 (static prefix) → fixed in `46f6de7`.
- v1 I-2 (Content-Type validation) → fixed in `46f6de7`.
- v1 I-3 (CSP + security headers) → partially re-fixed in `dd89b66` (frame-ancestors added).
- v1 I-4 (KV ETag cache) → fixed in `3079851`.
- v1 I-5 (curl config file for token) → fixed in `80e699b`.
- v1 I-6 (DOMAIN regex) → fixed in `3131b0f`.
- v1 M-1 (empty path) → fixed in `183926d`.
- v1 M-3 (DEV banner) → fixed in `a40339f`.
- v1 M-8 (build:copy guard) → fixed in `c0be5ae`.
- v1 M-9 (token rotation docs) → fixed in `c0be5ae`.

Plus v2 regressions prevented / cleaned up in this branch:

- dev `console.log` token leak (commit `0f3a955` / `125b62b`) → reverted in `f162ac3`.
- upload `authDebug` JSON 401 body leak → reverted in `f162ac3`.
- `.gitignore` inline-comment bug → fixed in `f568a4d`.

## Recommendation

Production-ready modulo **I-1 (vite CVE)**. Two options:

1. **Defer I-1** — vite CVE is dev/build-time only; the Worker runtime does not ship vite. Document in DEPLOY.md and revisit when vite 5 reaches end-of-life.
2. **Address I-1** — bump vite to `^7` (one major), re-run `npm run -w apt-client build`, commit. ~30 min of additional work in a follow-up branch.

Recommend option 1 for this branch (per "no major version bumps" constraint) and a follow-up branch for the vite bump.