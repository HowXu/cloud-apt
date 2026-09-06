# Chore + Security Audit v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert production-unsafe debug logging, commit pending fixes, add `--remove`/`--sync` flags to `build-and-push.sh`, add GPG key self-check, install CI, then run a full second-pass security audit and emit `docs/SECURITY-AUDIT-2.md`.

**Architecture:** Tightly scoped chore (Phases 1–5) executed as TDD-driven, single-purpose commits. Phase 6 dispatches four parallel subagents (Worker core / deploy-config / local-repo scripts / deb+client install) to discover findings, then aggregates into a v2 audit document.

**Tech Stack:** Hono 4 + TypeScript (Worker), Vue 3 + Vite (frontend), bash + reprepro + GPG (local repo), GitHub Actions (CI), Vitest 2.

## Global Constraints

- No new features. No major version bumps. Pinned majors: `hono@4`, `vue@3`, `vitest@2`, `wrangler@3`.
- Worker <-> local-repo API contract is frozen.
- Token constant is `ADMIN_PUSH_TOKEN`. Plain text comparison with constant-time XOR-OR is the only auth check.
- All bash scripts: `set -euo pipefail`.
- Each task = one commit, descriptive message.
- File paths relative to `/home/howxu/Projects/cloud-apt/` unless noted.

---

## Task 1: Revert dev-only `console.log` debug logging in `auth.ts`

**Files:**
- Modify: `apt-worker/src/shared/auth.ts` — drop `console.log`/`console.warn` lines that mention `token`, `TOKEN`, `PUSH`, `BEARER`, or `ADMIN_PUSH_TOKEN`.
- Create: `apt-worker/test/auth-no-leak.test.ts` — regression test that static-regex-checks `auth.ts` and `upload.ts` for forbidden patterns AND asserts `401` body is `unauthorized\n` (not JSON).

**Step 1 — Read current `auth.ts` to locate dev logging lines**

```bash
cd /home/howxu/Projects/cloud-apt
grep -nE "console\.(log|warn|error)\s*\(" apt-worker/src/shared/auth.ts
```

Expected: at least 2 hits containing `[DEBUG-AUTH]` or `[AUTH-MISMATCH]`.

**Step 2 — Edit `auth.ts`, remove the debug `console.*` lines**

Open the file, delete every `console.log(...)` / `console.warn(...)` line that mentions the token or `DEBUG`/`MISMATCH` markers. Keep the file's other logic untouched. After deletion, the function bodies should still call `checkAuth` and `headersSame` with no logging side-effects.

If the file's only logging was the dev logging, the function bodies become:

```ts
import type { Context, Next } from 'hono';

const TOKEN_KEY = 'ADMIN_PUSH_TOKEN';

export async function checkAuth(c: Context): Promise<boolean> {
  const expected = c.env[TOKEN_KEY];
  if (typeof expected !== 'string' || expected.length === 0) return false;
  const got = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!got) return false;
  return headersSame(got, expected);
}

function headersSame(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    if (await checkAuth(c)) return next();
    return c.text('unauthorized', 401);
  };
}
```

(Adapt to whatever non-logging lines exist in the file — only remove the `console.*` lines, do not touch other logic.)

**Step 3 — Write the regression test**

Create `apt-worker/test/auth-no-leak.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const FORBIDDEN = [
  /console\.(log|warn|error)\s*\([^)]*(token|TOKEN|PUSH|BEARER|DEBUG|MISMATCH)/i,
  /JSON\.stringify\([^)]*token/i,
  /\{\s*error\s*:\s*['"]unauthorized['"][^}]*token/i,
];

const FILES = [
  'apt-worker/src/shared/auth.ts',
  'apt-worker/src/upload.ts',
  'apt-worker/src/index.ts',
];

describe('no token leak via console or 401 body', () => {
  for (const rel of FILES) {
    it(`${rel} contains no forbidden logging`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      for (const re of FORBIDDEN) {
        expect(src).not.toMatch(re);
      }
    });
  }

  it('upload.ts 401 body is plain text', async () => {
    const { handleUpload } = await import('../src/upload');
    const env = { ADMIN_PUSH_TOKEN: 'x'.repeat(64), BUCKET: fakeBucket() } as any;
    const ctx = fakeCtx('PUT', '/api/upload/dists/foo', { auth: 'Bearer wrong' });
    const res = await handleUpload(ctx.req, env, 'dists/foo');
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toBe('unauthorized');
  };
});

function fakeBucket() {
  return { put: async () => undefined, delete: async () => undefined, get: async () => null, head: async () => null } as any;
}
function fakeCtx(method: string, path: string, opts: { auth: string }) {
  const req = new Request(`http://localhost${path}`, { method, headers: { authorization: opts.auth } });
  return { req };
}
```

Note: adapt the imports for `handleUpload` to whatever the actual exported function name is in `upload.ts`. Run `rg "^export" apt-worker/src/upload.ts` to find the right symbol. The intent is: invoke the upload handler with a wrong token, expect `401`, expect body `=== 'unauthorized'`.

**Step 4 — Run tests**

```bash
cd /home/howxu/Projects/cloud-apt
npm test -w apt-worker -- --run auth-no-leak
```

Expected: all assertions pass. If `handleUpload` export name differs, adjust the import and retry.

**Step 5 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add apt-worker/src/shared/auth.ts apt-worker/src/upload.ts apt-worker/test/auth-no-leak.test.ts
git commit -m "fix(worker): revert dev console.log token leak + regression test"
```

---

## Task 2: Commit pending `build-and-push.sh` `realpath` fix

**Files:**
- Modify: `local-repo/scripts/build-and-push.sh` — replace `"$DEB"` arg to reprepro with `realpath "$DEB"`.

**Step 1 — Inspect uncommitted change**

```bash
cd /home/howxu/Projects/cloud-apt
git diff -- local-repo/scripts/build-and-push.sh
```

Look for a line that says something like `reprepro ... includedeb kali-rolling "$DEB"` or `cp ... "$DEB"`. If the `realpath` is already applied, skip to Step 3.

**Step 2 — Apply the fix**

In `local-repo/scripts/build-and-push.sh`, wherever the script references `"$DEB"` (the user-supplied .deb path), add a `realpath` resolution near the top of the script (after argument parsing):

```bash
DEB_ABS="$(realpath "$DEB")"
```

Then replace any later use of `"$DEB"` with `"$DEB_ABS"` for `reprepro includedeb` / `cp` / `mv` / similar. For human-readable error messages keep the original `"$DEB"` so the user sees the path they typed.

If the file already has the realpath fix, this task is a no-op — just commit any other uncommitted whitespace fixes in this file.

**Step 3 — Smoke-test the script arg path**

```bash
cd /home/howxu/Projects/cloud-apt
bash -n local-repo/scripts/build-and-push.sh && echo "syntax OK"
```

Expected: `syntax OK`.

**Step 4 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add local-repo/scripts/build-and-push.sh
git commit -m "fix(local-repo): realpath DEB before reprepro includedeb"
```

---

## Task 3: Add GPG post-write self-check to `gen-key.sh`

**Files:**
- Modify: `local-repo/scripts/gen-key.sh` — after the block that writes `keyid.txt` and `public.key`, add a self-check that compares the written FPR against `gpg --list-secret-keys`.

**Step 1 — Locate the write block**

```bash
cd /home/howxu/Projects/cloud-apt
grep -nE "keyid\.txt|public\.key" local-repo/scripts/gen-key.sh
```

**Step 2 — Insert the self-check**

Immediately after the last write to `keyid.txt` (and after `gpg --export --armor`), add:

```bash
ACTUAL_FPR="$(gpg --list-secret-keys --with-colons "$GPG_EMAIL" 2>/dev/null | awk -F: '/^fpr:/ {print $10; exit}')"
if [[ -z "$ACTUAL_FPR" ]]; then
    echo "[gen-key] ERROR: no secret key found for $GPG_EMAIL after generation" >&2
    exit 1
fi
if [[ "$ACTUAL_FPR" != "$FPR" ]]; then
    echo "[gen-key] ERROR: post-write FPR mismatch — keyid.txt=$FPR keyring=$ACTUAL_FPR" >&2
    echo "[gen-key] This usually means keys/ was overwritten by stale data. Inspect:" >&2
    echo "  cat local-repo/keys/keyid.txt" >&2
    echo "  gpg --list-secret-keys --with-colons $GPG_EMAIL" >&2
    exit 1
fi
```

Adapt `$FPR` to whatever variable name the script uses (likely `FPR` or `KEY_FPR`). Look at the surrounding code.

**Step 3 — Smoke-test**

```bash
cd /home/howxu/Projects/cloud-apt
bash -n local-repo/scripts/gen-key.sh && echo "syntax OK"
```

Do not actually run `gen-key.sh` here — it generates a real GPG key and is slow. Syntax check is enough.

**Step 4 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add local-repo/scripts/gen-key.sh
git commit -m "fix(gen-key): post-write FPR self-check against keyring"
```

---

## Task 4: Add `--remove` and `--sync` flags to `build-and-push.sh`

**Files:**
- Modify: `local-repo/scripts/build-and-push.sh` — parse new flags, dispatch to `reprepro remove` / `reprepro export`.

**Step 1 — Read existing arg-parse section**

```bash
cd /home/howxu/Projects/cloud-apt
head -40 local-repo/scripts/build-and-push.sh
```

**Step 2 — Add flag handling**

Right after the existing arg-parse block (before any `reprepro includedeb` call), add:

```bash
MODE="include"   # default
REMOVE_PKG=""
case "${1:-}" in
    --remove)
        MODE="remove"
        REMOVE_PKG="${2:?--remove requires <package>}"
        shift 2
        ;;
    --sync)
        MODE="sync"
        shift
        ;;
    --help|-h)
        sed -n '2,20p' "$0"   # show header comment
        exit 0
        ;;
esac
```

Then, before any push step, branch on `$MODE`:

```bash
case "$MODE" in
    remove)
        log "reprepro remove kali-rolling $REMOVE_PKG"
        reprepo --confdir "$CONFDIR" remove "$SUITE" "$REMOVE_PKG"
        reprepo --confdir "$CONFDIR" export "$SUITE"
        log "package $REMOVE_PKG removed; re-signing suite"
        ;;
    sync)
        log "reprepro export $SUITE (sync only)"
        reprepo --confdir "$CONFDIR" export "$SUITE"
        ;;
    include)
        : "${DEB:?--include mode requires <path-to-deb>}"
        DEB_ABS="$(realpath "$DEB")"
        reprepo --confdir "$CONFDIR" includedeb "$SUITE" "$DEB_ABS"
        ;;
esac
```

Use the existing variable names from the file (`CONFDIR`, `SUITE`, `reprepo`/`reprepro`, `log`) — adapt as needed.

The push-to-Worker step after this block should still work for `remove`/`sync` because they only change `dists/*`, not `pool/*`. Verify that the push script diffs against the remote and only uploads new/changed files.

**Step 3 — Smoke-test syntax**

```bash
cd /home/howxu/Projects/cloud-apt
bash -n local-repo/scripts/build-and-push.sh && echo "syntax OK"
local-repo/scripts/build-and-push.sh --help
```

Expected: `syntax OK` + the header comment printed.

**Step 4 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add local-repo/scripts/build-and-push.sh
git commit -m "feat(build-and-push): add --remove and --sync reprepro-only modes"
```

---

## Task 5: Hygiene — `npm audit`, TODO scan, `.gitignore` audit

**Files:**
- Modify: `apt-worker/package.json` or `apt-client/package.json` if `npm audit` shows fixable issues.
- Modify: `.gitignore` only if a generated path is missing.

**Step 1 — Run `npm audit`**

```bash
cd /home/howxu/Projects/cloud-apt
npm audit --omit=dev 2>&1 | tee /tmp/npm-audit.txt
npm audit --omit=dev -w apt-worker 2>&1 | tee -a /tmp/npm-audit.txt
npm audit --omit=dev -w apt-client 2>&1 | tee -a /tmp/npm-audit.txt
```

Expected output: any Critical/High/Moderate. Use `npm audit fix` only if a Critical or High is present. Record results to be added into `SECURITY-AUDIT-2.md` later.

**Step 2 — Run `npm outdated` (no upgrades)**

```bash
cd /home/howxu/Projects/cloud-apt
npm outdated 2>&1 | tee /tmp/npm-outdated.txt
```

Record. No action unless Task 1 surfaced a vulnerable dep.

**Step 3 — TODO/FIXME scan**

```bash
cd /home/howxu/Projects/cloud-apt
rg -n 'TODO|FIXME|XXX|HACK' apt-worker/src apt-client/src local-repo/scripts example 2>&1 | tee /tmp/todos.txt
```

For each hit, either:
- Fix inline (if trivial), OR
- Add a `// see docs/SECURITY-AUDIT-2.md M-N` comment that references the audit doc (Phase 6), OR
- Leave it (if it was there pre-audit and is non-security).

**Step 4 — `.gitignore` coverage audit**

```bash
cd /home/howxu/Projects/cloud-apt
git check-ignore -v local-repo/dists local-repo/pool local-repo/db local-repo/keys local-repo/incoming \
    local-repo/conf/distributions example/artifacts apt-worker/dist apt-worker/wrangler \
    apt-client/dist 2>&1
```

Expected: every path reported as ignored with the rule that matched it. If any path is reported as NOT ignored, fix `.gitignore`.

**Step 5 — Verify nothing secret leaked into git history**

```bash
cd /home/howxu/Projects/cloud-apt
git ls-files | xargs -I{} sh -c 'head -c 200 "{}" 2>/dev/null | grep -lE "ADMIN_PUSH_TOKEN=[a-zA-Z0-9]{8,}" && echo "LEAK: {}"' 2>/dev/null
```

Expected: empty. If non-empty, investigate that file. (Run this only against tracked files, not ignored ones.)

**Step 6 — Commit**

If any TODO comments were annotated or `.gitignore` was patched:

```bash
cd /home/howxu/Projects/cloud-apt
git add -u
git commit -m "chore: hygiene pass — npm audit, TODO scan, .gitignore audit"
```

If nothing changed, skip the commit (empty commits are forbidden).

---

## Task 6: Cross-link docs + update `DEPLOY.md`

**Files:**
- Modify: `docs/DEPLOY.md` if `--remove`/`--sync` flags were added in Task 4.

**Step 1 — Inventory doc files**

```bash
cd /home/howxu/Projects/cloud-apt
git ls-files '*.md' | tee /tmp/docs.txt
```

**Step 2 — Cross-link check**

```bash
cd /home/howxu/Projects/cloud-apt
rg -oE '\]\(([^)]+\.md)\)' README.md README-en.md DEPLOY.md AGENTS.md docs/SECURITY-AUDIT.md docs/SECURITY-AUDIT-2.md \
    | sed 's/.*(\(.*\))/\1/' | sort -u
```

For each `.md` reference, verify the target file exists. Fix any broken links.

**Step 3 — Update `DEPLOY.md`**

Append a new section "Removing a package / syncing without rebuilding":

```markdown
## Removing a package

```bash
./local-repo/scripts/build-and-push.sh --remove <package-name>
```

This calls `reprepro remove` + `reprepro export` and uploads only the
changed `dists/*` files. Use this to retire a package version without
pushing a new .deb.

## Syncing after manual reprepro edits

```bash
./local-repo/scripts/build-and-push.sh --sync
```

Calls `reprepro export` and uploads `dists/*`. Use after `reprepro
expire`, `reprepro filter`, etc.
```

**Step 4 — Verify all docs still render**

```bash
cd /home/howxu/Projects/cloud-apt
ls docs/
```

**Step 5 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add docs/DEPLOY.md README.md README-en.md AGENTS.md 2>/dev/null
git commit -m "docs: cross-link audit + DEPLOY.md --remove/--sync" || echo "nothing to commit"
```

---

## Task 7: Ensure `apt-client` has a `typecheck` npm script

**Files:**
- Modify: `apt-client/package.json` — add `typecheck` script if missing.

**Step 1 — Check current scripts**

```bash
cd /home/howxu/Projects/cloud-apt
node -e "console.log(JSON.stringify(require('./apt-client/package.json').scripts, null, 2))"
```

**Step 2 — Add if missing**

If `typecheck` is not present, add it to `apt-client/package.json` `scripts`:

```json
"typecheck": "vue-tsc --noEmit"
```

**Step 3 — Verify**

```bash
cd /home/howxu/Projects/cloud-apt
npm run typecheck -w apt-client
```

Expected: exit 0, no type errors.

**Step 4 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add apt-client/package.json
git commit -m "chore(apt-client): add typecheck npm script"
```

---

## Task 8: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/test.yml`.

**Step 1 — Inspect repo for CI hints**

```bash
cd /home/howxu/Projects/cloud-apt
ls .github/ 2>/dev/null || echo "no .github yet"
```

**Step 2 — Write the workflow file**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  worker-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run -w apt-worker test
      - run: npm run -w apt-worker typecheck

  client-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run -w apt-client typecheck

  worker-build-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: cd apt-worker && npx wrangler deploy --dry-run --outdir=dist-test
```

**Step 3 — Commit + push**

```bash
cd /home/howxu/Projects/cloud-apt
git add .github/workflows/test.yml
git commit -m "ci: add worker test, client typecheck, wrangler dry-run"
git push origin main
```

Then wait for CI to complete. Confirm green by viewing `gh run list --limit=1` or checking the GitHub UI.

If the workflow has errors, fix in place (e.g., `vue-tsc` requires Node 20+ on the runner, which 22 satisfies; if wrangler dry-run fails on `[build]` step, skip the wrangler job and add a comment).

**Step 4 — Record CI URL**

Add to `DEPLOY.md` top:

```markdown
[![CI](https://github.com/<owner>/cloud-apt/actions/workflows/test.yml/badge.svg)](...)
```

Replace `<owner>` with the actual GitHub org/user. Commit the README/DEPLOY update as part of Task 6's commit (defer if already done).

---

## Task 9: Security audit v2 — dispatch 4 parallel subagents

**Files:**
- Create: `docs/SECURITY-AUDIT-2.md`.

**Step 1 — Dispatch the four subagents in parallel**

Use the `task` tool with `subagent_type: "general"` for each, in one message with four task calls. Each subagent gets:

```text
You are running a focused security audit pass on /home/howxu/Projects/cloud-apt.

Focus area: <one of A/B/C/D below>

Existing audit at docs/SECURITY-AUDIT.md (read first).

Return a JSON array of findings:
[{"severity":"Critical|Important|Minor","file":"path","line":N,"issue":"...","fix":"...","verification":"..."}]

Be precise: every finding must include exact file path + line number + a 1-line verification command.

Do NOT modify any files. Read-only audit.
```

The four focus areas:

**Subagent A — Worker core**:
Files: `apt-worker/src/**/*.ts`. Check: auth bypass, token compare, path traversal in upload/proxy, cache poisoning, ETag manipulation, CSP, content-type whitelist, observability leaks, dead code, route table completeness (every route in `index.ts` has an auth check or is explicitly public per README).

**Subagent B — Deploy & config**:
Files: `apt-worker/wrangler.toml`, `apt-worker/wrangler-dev.toml`, `apt-worker/package.json`, `apt-client/package.json`, `tsconfig.json`, top-level `package.json`. Check: secrets in plain text, CORS misconfig, allowed dev URLs, observability log retention, dependency supply chain (cross-check `/tmp/npm-audit.txt` if present), peer deps mismatches.

**Subagent C — Local-repo scripts**:
Files: `local-repo/scripts/*.sh`, `local-repo/conf/distributions.template`, `local-repo/Dockerfile.kali-rolling`. Check: command injection via filenames, env leak via `ps`, reprepro parser injection (SignWith field), path traversal in migrate scripts, key file perms, passphrase strength, atomic file writes.

**Subagent D — Example deb + client install**:
Files: `example/`, `local-repo/scripts/install.sh`, `local-repo/scripts/uninstall.sh`. Check: postinst root actions, symlink in `/usr/local/bin` (TOCTOU), control file injection, `curl|bash` trust chain, sources.list.d injection, uninstall completeness (sources/keyring/cache/purge flag).

**Step 2 — Aggregate findings**

Combine all four JSON arrays into one table. Sort by severity (Critical → Important → Minor), then by file path. Output to `docs/SECURITY-AUDIT-2.md`.

**Step 3 — Write the audit doc**

Format (mirrors `docs/SECURITY-AUDIT.md`):

```markdown
# Cloud APT — Security Audit v2 (2026-09-06)

**Scope**: full second-pass review covering everything new since v1 audit (commit `c0be5ae`) plus any v1 findings not yet addressed.

**Method**: 4 parallel static reviews by subagent, aggregated into this document.

**Verdict**: <X> Critical, <Y> Important, <Z> Minor.

## Findings

### Critical
(none)

### Important
- **I-1: <title>** — `path/to/file.ts:NN` — <description> — *fix*: <fix> — *verify*: `command`.

### Minor
- **M-1: <title>** — ...

## Cross-references to v1
- See also SECURITY-AUDIT.md I-3 (CSP) — unchanged.

## Resolved since v1
- I-1 (static prefix) — fixed in commit `46f6de7`.
- ...
```

**Step 4 — Fix any Critical findings inline in this branch before committing the audit doc**

If the audit surfaces a Critical, do NOT commit the audit doc with the Critical still open. Fix the Critical, run tests, commit the fix, then commit the audit doc.

**Step 5 — Commit**

```bash
cd /home/howxu/Projects/cloud-apt
git add docs/SECURITY-AUDIT-2.md
git commit -m "docs(audit): SECURITY-AUDIT-2 — full second-pass findings"
```

If any fix commits were made in Step 4, commit those first.

---

## Task 10: Final review pass

**Files:**
- Possibly modify: `README.md`, top-level — add a "v0.1.0 audited" badge pointer.

**Step 1 — Verify everything committed**

```bash
cd /home/howxu/Projects/cloud-apt
git status
git log --oneline main -10
```

**Step 2 — Run full test suite once more**

```bash
cd /home/howxu/Projects/cloud-apt
npm test -w apt-worker -- --run
npm run typecheck -w apt-worker
npm run typecheck -w apt-client
```

All must pass.

**Step 3 — Verify CI green**

```bash
cd /home/howxu/Projects/cloud-apt
gh run list --limit=3
```

Latest run should be green.

**Step 4 — Update `README.md` audit section**

In `README.md`, under any "Security" / "Status" section, add a one-line pointer to v2:

```markdown
- Security audit v2: see [docs/SECURITY-AUDIT-2.md](docs/SECURITY-AUDIT-2.md) (2026-09-06).
```

**Step 5 — Commit (if any change in Step 4)**

```bash
cd /home/howxu/Projects/cloud-apt
git add README.md
git commit -m "docs: link SECURITY-AUDIT-2 from README" || echo "nothing to commit"
```

---

## Self-Review Notes (added after writing the plan)

- **Spec coverage**: every spec section maps to a task (Phase 1 → Tasks 1, 2; Phase 2 → Tasks 2, 3; Phase 3 → Task 4; Phase 4 → Task 5; Phase 5 → Task 8; Phase 6 → Task 9; final wrap → Task 10). Docs update → Task 6. `apt-client typecheck` script → Task 7.
- **Placeholder scan**: no TBDs; code blocks shown for all code steps.
- **Type consistency**: variable names (`FPR`, `DEB_ABS`, `MODE`, `REMOVE_PKG`, `CONFDIR`, `SUITE`) introduced where needed with exact names. `handleUpload` is called out as "adapt to actual export name" — engineer must `rg "^export"` first.