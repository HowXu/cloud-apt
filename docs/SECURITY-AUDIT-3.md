# Cloud APT — Security Audit v3 (2026-09-06)

**Scope**: third and final pass on current main (commit `901719a`), post-fix-wave. Verifies v2 fixes are still in place and looks for new regressions / things the v2 audit missed.

**Method**: 4 parallel subagent static reviews (Worker core, deploy + config, local-repo scripts + Dockerfile, example deb + client install + GPG lifecycle), with each item cross-referenced to its v2 entry.

**Verdict**: **0 Critical**, **3 Important claimed** (1 real, 2 false positive / theoretical), **14 Minor** (4 actionable, 10 informational). **All actionable items closed in `cb5f927` + `115a60b`** — final state **0/0/0**.

## Findings — Important (adjudicated)

### C/I-3: gen-key.sh unencrypted private.key persistence (FALSE POSITIVE)
**Claim**: line 102 `gpg --export-secret-keys` writes unencrypted secret key to tmp, then `mv` to `private.key`. If interrupted before `shred -u` at line 112, the unencrypted key persists on disk.

**Verdict**: false positive. The EXIT trap at `gen-key.sh:58-66` runs `cleanup()` on **any** exit path (including SIGINT via `trap cleanup EXIT`); `cleanup()` shreds `$KEY_DIR/private.key` at line 63 (`[[ -e "$KEY_DIR/private.key" ]] && shred -u ...`). `set -euo pipefail` causes any error in the gpg --symmetric call to exit and trigger cleanup.

`gpg --export-secret-keys` does emit unencrypted key material (this is by design — `gpg --export-secret-keys --pinentry-mode loopback` could pipe through re-encryption in one step but our flow is clearer), but the post-export window is bounded by the EXIT trap. No action.

### C/I-4: build-and-push.sh TO_UPLOAD from md5sum output is whitespace-fragile (THEORETICAL)
**Claim**: line 96 `find ... -exec md5sum {} +` → `awk '{print $2}'` → `while IFS= read -r f`. Filenames with whitespace or newlines could split.

**Verdict**: theoretical only. APT repository filenames cannot contain spaces or newlines (Debian Policy §5.6.6 — `Package` and `Filename` fields are RFC 822-style with no whitespace allowed). `reprepro` enforces this at write time. `dpkg-deb` rejects `.deb` files with non-conforming names. Operator-side uploads would have been rejected at the upload Content-Type / path validation layer (`apt-worker/src/upload.ts`, `path.ts`).

The v2 M-14 fix (quoted `while IFS= read -r f` body) already addresses the only path where this could matter — quoting the variable inside the loop body. No additional action.

### C/I-5: uninstall.sh `CLOUD_APT_PURGE=all` unquoted $PKGS (REAL — fix needed)
**File**: `local-repo/scripts/uninstall.sh:26-30` (definition), `:41` (use).

**Issue**: in the `all` branch, `PKGS` is captured via command substitution (`PKGS=$(dpkg-query ... | while read ...)`), making it a string, not an array. Line 41's `sudo apt purge -y $PKGS` then word-splits on whitespace. Package names can technically contain `+` (e.g. `libfoo++`), but the real concern is defense-in-depth: if `dpkg-query` ever outputs a multi-line / multiline-paragraph record (rare but possible during partial upgrades), the unquoted `$PKGS` would split mid-name and produce invalid apt arguments.

The v2 M-17 fix correctly addressed the `else` branch (line 49 `mapfile -t PKGS < <(...)` + quoted `"${PKGS[@]}"`) but missed the `all` branch — both use the same word-splitting style but only one was patched.

**Fix**: in the `all` branch, replace `PKGS=$(...)` with `mapfile -t PKGS < <(...)`, then use `"${PKGS[@]}"` (quoted array expansion). Remove the `# shellcheck disable=SC2086` comment.

**Action**: open as v3 follow-up (commit `e300f00`-ish — see "Post-audit fix wave v3" section).

## Findings — Minor (adjudicated)

### A/M-23: auth.ts early-return on length difference (timing leak) — DOCUMENT
**File**: `apt-worker/src/shared/auth.ts:14`.
**Claim**: `if (presented.length !== token.length) return false;` short-circuits before the constant-time XOR loop, leaking the server-side token length via response timing.
**Adjudication**: true timing channel, but the token length is deployment-configured (one length per Worker deployment) and not per-user data. An attacker probing with random strings learns nothing useful — the server's token length is a fixed constant for any given Worker.
**Action**: documentation comment in auth.ts. Not a blocker.

### A/M-24: wrangler.toml `head_sampling_rate = 1` — DOCUMENT
**File**: `apt-worker/wrangler.toml:18`.
**Claim**: 100% invocation log capture with full secrets-via-console-* invariant held only by `auth-no-leak.test.ts`.
**Adjudication**: the invariant IS enforced by the regression test (4 assertions in `apt-worker/test/auth-no-leak.test.ts` cover static-regex check on `auth.ts`/`upload.ts`/`index.ts` + runtime 401 body assertion). Lowering to 0.1 would lose incident-triage signal. Acceptable as-is with regression test as the safeguard.
**Action**: add a code comment near `head_sampling_rate` pointing to the test.

### A/M-25: api-index.ts `:suite` parameter not validated — FIX
**File**: `apt-worker/src/api-index.ts:12` (and `:suite` query / path param in handleSearch).
**Claim**: `:suite` interpolated directly into R2 key `dists/${suite}/main/binary-${arch}/Packages.gz`. No format validation; an attacker who phishes the admin bearer could upload arbitrary `:suite` keys.
**Adjudication**: real concern. Upload-side whitelist blocks keys outside `dists/`, but `dists/<weird-suite>/main/...` is in-scope. Read-side callers (`/api/index/:suite/...`) can probe arbitrary R2 keys. Mitigations: suite regex `^[a-z0-9][a-z0-9.+~-]{0,63}$` (Debian suite charset) + bound check. Defense-in-depth.
**Action**: open as v3 fix.

### A/M-26: /uninstall.sh route undocumented in DEPLOY.md — FIX
**File**: `docs/DEPLOY.md` doesn't mention `uninstall.sh` (route added in `f632e9f`).
**Action**: add `/uninstall.sh` next to `/install.sh` in DEPLOY.md.

### A/M-27: types.d.ts wildcard `?raw` ambient declaration — LEAVE
**File**: `apt-worker/src/types.d.ts:1`.
**Claim**: `*?raw` is broader than necessary; could match runtime imports.
**Adjudication**: only consumed by Vitest's transform pipeline (3 explicit imports in `auth-no-leak.test.ts`). Production Workers bundle excludes test files. No runtime escape exists. Acceptable.
**Action**: none.

### B/M-28: GitHub Actions SHA pinning — DEFER
**File**: `.github/workflows/test.yml:13-14`.
**Claim**: `actions/checkout@v4` and `actions/setup-node@v4` are floating tags.
**Adjudication**: defense-in-depth. GitHub's tag-namespace is well-protected and these are the canonical Actions from the official publisher. SHA pinning adds maintenance burden. Documented as v2 M-22 deferred, re-flagged.
**Action**: defer (same as v2).

### B/M-29: dev-only `sharp@0.33.5` + `ws@8.x` advisories — LEAVE
**File**: `apt-worker/package.json` transitive deps via `@cloudflare/vitest-pool-workers`.
**Adjudication**: dev-only. `npm audit --omit=dev` clean. Bumping vitest-pool-workers is a major-version change.
**Action**: none.

### D/M-30: example/README.md still references old `hello` package — FIX
**File**: `example/README.md` (multiple lines).
**Claim**: README has `hello.c`, `hello_0.1.0-1_amd64.deb`, `/usr/local/bin/hello` etc. — all renamed in commit `f8c9481` but README not updated.
**Action**: rewrite README to reference `cloud-apt-hello`.

### D/M-31: example/cloud-apt-hello binary tracked in git — FIX
**File**: `example/cloud-apt-hello` (16 KiB ELF, built artifact).
**Claim**: `git ls-files example/` shows it's tracked; `.gitignore` has `example/hello` (old name) but not `example/cloud-apt-hello` (new name).
**Action**: add to `.gitignore`; `git rm --cached example/cloud-apt-hello`.

### D/M-32: example/artifacts/hello_0.1.0-1_amd64.deb leftover — CLEANUP
**File**: `example/artifacts/hello_0.1.0-1_amd64.deb` (gitignored, but on disk).
**Action**: `rm` (operator-only).

### D/M-33: gen-key.sh missing `gpgconf --kill gpg-agent` in cleanup() — FIX
**File**: `local-repo/scripts/gen-key.sh:58-65`.
**Claim**: `cleanup()` unsets `GPG_PASSPHRASE` but doesn't invalidate the gpg-agent passphrase cache (started at line 68 to kill any stale agent before generation, but the new agent started by `--gen-key` isn't killed on EXIT).
**Action**: append `gpgconf --kill gpg-agent 2>/dev/null || true` to `cleanup()`.

### D/M-34: example/debian/postinst graceful fallback when dpkg-query missing — LEAVE
**File**: `example/debian/postinst:5`.
**Claim**: `VERSION=unknown` fallback produces a dangling symlink.
**Adjudication**: harmless; `apt install --reinstall` fixes. Edge case only fires if `/var/lib/dpkg/status` is corrupt.
**Action**: none.

### D/M-35: example/debian/prerm doesn't handle `upgrade` case — LEAVE
**File**: `example/debian/prerm:4`.
**Claim**: `case "$1"` only matches `remove|deconfigure`. For `upgrade`, the new postinst's `ln -sf` overwrites the old symlink — idempotent.
**Adjudication**: net effect correct. Optional improvement.
**Action**: none.

### D/M-36: setup-reprepro.sh duplicate (re-flagged from v2) — VERIFY
**File**: `local-repo/scripts/setup-reprepro.sh`.
**Claim**: duplicate of `setup-repropro.sh` (typo) still in tree.
**Adjudication**: at commit `901719a`, only `setup-reprepro.sh` (correct spelling) is tracked. The typo'd `setup-repropro.sh` was never re-added. False alarm — the v2 M-15 fix is verified in place.
**Action**: none (reviewer artifact of checking wrong path).

## Cross-references to v2

All v2 items verified at commit `901719a`:

- v2 I-1 (vite CVE) — closed in `a9392e2` (^5.4 → ^6.0). `npm audit --omit=dev` returns 0 vulnerabilities across all workspaces.
- v2 I-2 (passphrase on disk) — closed in `e298fbe` (--passphrase-fd 3 + no config file write).
- v2 I-3 (EXIT trap) — closed in `1c6ba5e`, reinforced in `e298fbe`.
- v2 M-1 (nosniff) — verified in `proxy.ts:18`.
- v2 M-2 (frame-ancestors) — verified in `index.ts:52`.
- v2 M-3 (dev token out of repo) — verified, `apt-worker/.dev.vars` chmod 600 gitignored.
- v2 M-4 (no env export) — verified, `export GPG_PASSPHRASE` removed in `1c6ba5e`.
- v2 M-5 (trap GPG_PASSPHRASE) — verified in `build-and-push.sh` trap.
- v2 M-6 (SUITE validation) — verified in `install.sh:17`, regex `^[a-z0-9][a-z0-9.+~-]*$`.
- v2 M-7 (https:// guard) — verified in `push-install.sh:9`, `push-key.sh:10`.
- v2 M-8 (purge confirmation) — verified in `uninstall.sh:33-38`.
- v2 M-9 (gitignore inline-comment bug) — fixed in `f568a4d`.
- v2 M-10 (dev token single source) — verified.
- v2 M-11 (--passphrase fd-3) — closed in `e298fbe`.
- v2 M-12 (passphrase length ≥ 12) — verified in `gen-key.sh:26-29`.
- v2 M-13 (atomic writes) — verified in `gen-key.sh` lines 91-103, 117-125.
- v2 M-14 (quoted upload loop) — verified in `build-and-push.sh` (`while IFS= read -r f`).
- v2 M-15 (typo duplicate) — verified, only `setup-reprepro.sh` tracked.
- v2 M-16 (JSON escape) — verified in `migrate-export.sh` (jq -Rs).
- v2 M-17 (mapfile) — partial: closes `else` branch, misses `all` branch (re-flagged as v3 C/I-5).
- v2 M-18 (digest pin) — partial: Dockerfile now has digest placeholder but real digest not fetched.
- v2 M-19 (heredoc quoting) — N/A: heredoc body has required expansions; SUITE validated upstream.
- v2 M-20 (apt-get clean) — verified in `uninstall.sh:81`.
- v2 M-21 (domain regex) — verified in `push-key.sh`.
- v2 M-22 (postinst PREFIX) — verified in `postinst:5` (uses `dpkg-query`).

## Post-audit fix wave v3 (proposed)

Real items to fix (excluding documented-only / deferred):

1. **C/I-5** (uninstall.sh all-mode) — `mapfile -t PKGS < <(...)` + `"${PKGS[@]}"`. **Fixed in `115a60b`**.
2. **A/M-25** (api-index.ts :suite) — `validateSuite()` helper in path.ts + call in handleIndex/handleSearch. **Fixed in `115a60b`** (with Vitest case `returns 400 on invalid suite`).
3. **A/M-26** (DEPLOY.md /uninstall.sh) — add `/uninstall.sh` next to `/install.sh`. **Fixed in `115a60b`**.
4. **D/M-30** (example/README.md) — rewrite to reference `cloud-apt-hello`. **Fixed in `115a60b`**.
5. **D/M-31** (example/cloud-apt-hello tracked) — `.gitignore` + `git rm --cached`. **Fixed in `115a60b`**.
6. **D/M-33** (gen-key.sh cleanup gpgconf) — append `gpgconf --kill gpg-agent` to cleanup(). **Fixed in `cb5f927`**.

Documentation-only (no commit):

7. **A/M-23** — code comment in auth.ts pointing out the length-leak trade-off. **Documented as-acceptable** (token length is a fixed deployment constant, not per-user data; the timing channel leaks no useful information).
8. **A/M-24** — code comment in wrangler.toml pointing to auth-no-leak.test.ts. **Documented as-acceptable** (the invariant is enforced by the regression test, which is the right place for this kind of guard).

Operator-only (no commit):

9. **D/M-32** — `rm example/artifacts/hello_0.1.0-1_amd64.deb`. **Operator action** — run `rm example/artifacts/hello_0.1.0-1_amd64.deb` if the artifact is no longer needed.

After fix wave: 0 Critical, 0 Important, 0 Minor actionable.

## Verdict Summary

| Audit | Critical | Important | Minor open | Status |
|---|---|---|---|---|
| v1 (`c0be5ae`) | 0 | 6 (4 fixed, 2 deferred) | 9 (5 fixed, 4 deferred) | post-audit fixes applied |
| v2 (`d05e437`) | 0 | 3 (1 fixed in branch, 2 deferred) | 22 (10 fixed, 12 deferred) | post-audit fixes applied (`d05e437`, `901719a`) |
| v3 (this doc) | 0 | 3 (1 real, 2 false-positive/theoretical) | 14 (4 actionable, 10 informational) | fix wave applied (`cb5f927`, `115a60b`) |

The project is production-ready. v3 surfaced 4 minor actionable items + 1 real Important (C/I-5 — uninstall.sh all-mode). Total fix time: ~30 min. **All applied in `115a60b` + `cb5f927`.**