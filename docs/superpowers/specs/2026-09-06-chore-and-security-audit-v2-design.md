# Cloud APT — Wrap-up Chore + Security Audit v2

**Date**: 2026-09-06
**Owner**: howxu
**Status**: Approved
**Goal**: clean up tech debt accumulated during v0.1.0 dev cycle, revert production-unsafe debug logging, add CI, then run a full second-pass security audit before declaring production-ready.

## Background

The project shipped v0.1.0 (~50 commits) with one security audit (see `docs/SECURITY-AUDIT.md`). Since the audit the following landed:

- `local-repo/scripts/{gen-key.sh, build-and-push.sh, push-key.sh, push-install.sh, migrate-export.sh, migrate-import.sh, setup-repropro.sh, uninstall.sh}` — entirely new scripts.
- `example/` — new hello-world deb package, renamed to `cloud-apt-hello`.
- `apt-worker/src/shared/{auth.ts, upload.ts, path.ts, index.ts}` — dev debug logging added to `auth.ts` (commit `125b62b`) and to `upload.ts` 401 response body (commit `be0233a`). **Both leak `ADMIN_PUSH_TOKEN`** in console + in plaintext HTTP responses. These are uncommitted-to-main regressions from the audit trail.
- `local-repo/conf/distributions.template` — reprepro template.
- Operational hazard: GPG `keyid.txt` + `public.key` can fall out of sync with keyring (observed 2026-09-06). `gen-key.sh` was patched to refuse duplicate email keys but no post-write self-check exists.

The user wants:
1. Cleanup chore across the whole project.
2. Add CI.
3. Full second-pass security audit covering everything (Worker, scripts, deb, GPG, config, frontend, deploy).

## Non-Goals

- No new features (no repo browser UI, no per-tenant keys, no scheduled tasks).
- No major version bumps of pinned deps (`hono@4`, `vue@3`, `vitest@2`, `wrangler@3`).
- No breaking changes to `Worker <-> local-repo` API contract.
- No new specs/feature work — strictly wrap-up.

## Design

### Phase 1 — Critical: revert dev-only debug logging

**Files**:
- `apt-worker/src/shared/auth.ts`: drop `console.log('[DEBUG-AUTH] ...')` and `console.warn('[AUTH-MISMATCH] ...')` lines.
- `apt-worker/src/upload.ts`: revert 401 from `{ error: 'unauthorized', token_prefix: '...' }` to plain text `unauthorized\n`.

**Tests**: add `test/auth-no-leak.test.ts` asserting:
- 401 response body is `unauthorized\n` exactly (not JSON, no token fragments).
- No `console.log` / `console.warn` calls reference `token`, `ADMIN_PUSH_TOKEN`, or env `WORKER_URL` paths.
- Verify via static regex: `grep -RE '(console\.(log|warn)\s*\(\s*[\"\'][^\"\']*(token|TOKEN|PUSH))' apt-worker/src` returns empty.

**Why**: the dev logging currently ships `ADMIN_PUSH_TOKEN` to anyone who can send a malformed request. Cloudflare Workers log piping (`[observability.logs]`) would also capture it.

### Phase 2 — Commit pending changes

Already-written, not yet committed:

- `local-repo/scripts/build-and-push.sh`: replace `"$DEB"` arg with `realpath "$DEB"` so reprepro can find the file when called after `cd $REPO_ROOT`.
- `local-repo/scripts/gen-key.sh`: add post-write self-check that compares the FPR written to `local-repo/keys/keyid.txt` against `gpg --list-secret-keys --with-colons $GPG_EMAIL` FPR. Fail-fast if they diverge (the bug observed today — file synced from an old key after keyring had rotated).

### Phase 3 — Tooling additions

Add `--remove <pkg>` and `--sync` flags to `build-and-push.sh` for reprepro-only operations (no .deb needed). This avoids the manual `reprepro remove` + curl-loop pattern from the recent `cloud-apt-hello` ops session.

Behavior:
- `--remove <pkg>` → `reprepro --confdir ./conf remove kali-rolling <pkg>` → `reprepro --confdir ./conf export kali-rolling` → upload changed `dists/*` (no `pool/*` writes).
- `--sync` → `reprepro --confdir ./conf export kali-rolling` → upload all `dists/*`.
- Default (no flag): current behavior, requires .deb arg.

Add tests for the argument-parsing branch (bash unit, smoke).

### Phase 4 — Hygiene

- `npm audit --omit=dev` for both `apt-worker/` and `apt-client/` workspaces — record findings in `SECURITY-AUDIT-2.md`.
- `npm outdated` — record but no major upgrades.
- `rg -n 'TODO|FIXME|XXX|HACK'` — fix or file issue for each result. If already tracked in `docs/SECURITY-AUDIT.md` or this design doc, leave.
- `.gitignore` cross-check: walk all paths under `local-repo/` + `apt-worker/` + `example/` + `apt-client/` and verify every generated/runtime dir is ignored. The `.gitignore` already covers most — verify no `local-repo/conf/distributions` (live file) ever gets staged. Add `local-repo/scripts/setup-repropro.sh` to `.gitignore` only if it's intentionally untracked (it currently is untracked).
- README cross-link check: every doc file referenced from `README.md`, `README-en.md`, `DEPLOY.md`, `AGENTS.md`, `docs/SECURITY-AUDIT.md` must exist; every doc file present must be linked from at least one of those.
- Update `DEPLOY.md` if `--remove` / `--sync` flags added.

### Phase 5 — CI

Add `.github/workflows/test.yml`:
- Triggers: `push` to `main`, `pull_request` to `main`.
- Jobs:
  - `worker-test`: checkout → `npm ci` → `npm run -w apt-worker test` → `npm run -w apt-worker typecheck`.
  - `client-typecheck`: `npm run -w apt-client typecheck` (no headless browser for SPA — too heavy for free CI).
  - `lint` (if eslint config exists — currently no, skip).
- Optional `worker-build` smoke (catches wrangler.toml issues): `npx wrangler deploy --dry-run --outdir=dist-test` — adds ~30s, recommended.
- No deploy job (user deploys manually via `wrangler deploy` after CI green; documented in DEPLOY.md).

Add `apt-client/package.json` `typecheck` script if missing — currently the project has `vue-tsc --noEmit` referenced but no npm script.

### Phase 6 — Security audit v2 (Full 二轮)

Run 4 parallel subagents (one per focus area), each returns a findings table (`{severity, file:line, issue, fix, verification}`). I aggregate into `docs/SECURITY-AUDIT-2.md`.

| Subagent | Files | Focus |
|---|---|---|
| A. Worker core | `apt-worker/src/**/*.ts` | auth bypass, token compare, path traversal in upload/proxy, cache poisoning, ETag manipulation, CSP, content-type, observability leaks |
| B. Deploy & config | `wrangler.toml`, `wrangler-dev.toml`, `package.json`, `tsconfig.json` | secrets in plain text, CORS misconfig, allowed dev URLs, observability log retention, dependency supply chain (`npm audit`) |
| C. Local-repo scripts | `local-repo/scripts/*.sh`, `local-repo/conf/distributions.template`, `local-repo/Dockerfile.kali-rolling` | command injection via filenames, env leak via `ps`, reprepro parser injection, path traversal in migrate scripts, key file perms, passphrase strength |
| D. Example deb + client install | `example/`, `local-repo/scripts/install.sh`, `local-repo/scripts/uninstall.sh` | postinst root actions, symlink in `/usr/local/bin`, control file injection, `curl|bash` trust, sources.list.d injection, cleanup completeness |

Severity scale (same as v1):
- **Critical**: full compromise of auth or data integrity without prior access.
- **Important**: requires minor preconditions to exploit; or limited blast radius.
- **Minor**: hardening / hygiene; defense-in-depth.

Output format: same as `docs/SECURITY-AUDIT.md`. Cross-link findings back to v1 (`see also: SECURITY-AUDIT.md I-3`).

## Deliverables

- `apt-worker/src/shared/auth.ts`, `apt-worker/src/upload.ts`: debug logging reverted + new test.
- `apt-worker/test/auth-no-leak.test.ts`: regression test.
- `local-repo/scripts/build-and-push.sh`: `realpath` fix + `--remove` + `--sync` flags.
- `local-repo/scripts/gen-key.sh`: post-write FPR self-check.
- `apt-client/package.json`: `typecheck` script if missing.
- `.github/workflows/test.yml`: CI.
- `docs/DEPLOY.md`: updated with `--remove` / `--sync` / CI badge.
- `docs/SECURITY-AUDIT-2.md`: full findings table + verdict (Critical/Important/Minor count).
- 1 commit per phase (5–7 total commits in chore branch).
- 1 commit for audit doc.

## Open Questions

None — user confirmed scope.

## Success Criteria

- [ ] Phase 1: `rg -RE 'token|TOKEN' apt-worker/src/auth.ts apt-worker/src/upload.ts` returns only references that are part of env read + constant-time compare; no `console.*` calls reference these identifiers.
- [ ] Phase 1: `npm test` passes including new `auth-no-leak` test.
- [ ] Phase 2: uncommitted changes committed with descriptive messages.
- [ ] Phase 3: `bash -n build-and-push.sh` + manual `--remove <existing-pkg>` smoke run on local repo (round-trip: remove → re-look-up → confirm gone).
- [ ] Phase 4: `npm audit` shows no Critical; all TODO/FIXME either fixed or referenced in issue; `.gitignore` covers all generated paths.
- [ ] Phase 5: CI green on first push.
- [ ] Phase 6: `docs/SECURITY-AUDIT-2.md` committed; 0 Critical; all Important items either fixed in this branch or queued for next branch with issue references.

## Implementation Order

1. Phase 1 (auth revert + test) → run tests → commit.
2. Phase 2 (commit pending changes) → commit each.
3. Phase 3 (tooling) → smoke test → commit.
4. Phase 4 (hygiene) → single commit batch.
5. Phase 5 (CI) → commit + push + verify CI green.
6. Phase 6 (audit v2) → 4 parallel subagents → aggregate → 1 audit doc commit.
7. Final pass: update CHANGELOG or release notes pointer at top of `README.md` if applicable.