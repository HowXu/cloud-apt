# local-repo

Local repository tooling for `cloud-apt`. After forking, two public
commands cover everything:

```bash
./local-repo/scripts/init.sh         # first run: write config, prep GPG, push pubkey + client scripts
./local-repo/scripts/push.sh pkg.deb # daily use: sign + push a .deb
```

## Tool requirements

- reprepro
- GPG 2.x
- curl
- Python 3.10+,the publisher and migrate use only the standard library, no pip dependencies

## Configuration

`init.sh` writes the Worker URL and upload token to
`local-repo/config.env`. 

The GPG passphrase is never written
to disk — `push.sh` prompts for it on each invocation.

CI environments can drop a `local-repo/config.env` directly:

```bash
WORKER_URL="https://apt.example.com"
ADMIN_PUSH_TOKEN="..."
```

## Advanced entry points

`build-and-push.sh --remove <pkg>` and `--sync` are still available for
advanced maintenance.

For migration use `migrate-export.sh` /
`migrate-import.sh`.

## Publishing, retry, and version consistency

When upgrading, deploy the new Worker first, then update the local
scripts. Until the first successful publish with the new scripts, the
Worker continues to read the existing `dists/`; after that first
commit, both the browse API and APT serve from the committed snapshot.
After that, do **not** use an older script to overwrite `dists/` — it
will not switch the current snapshot.

The publisher holds a local exclusive lock across the whole
include/sign/upload cycle. It copies the suite's `.deb`, indexes, and
signatures into `.publish/`, sends SHA256 for every file, and only
records completion once the Worker confirms. The final
`/api/publish/<suite>` validates every listed remote object and uses
R2 conditional writes to switch the current version atomically. If
another maintainer publishes first, the request returns a conflict and
does not overwrite their new version.

```bash
# Network failure: retry the original command, or resume the saved
# snapshot without needing the original .deb
./local-repo/scripts/build-and-push.sh --resume kali-rolling

# Remote was mutated out of band, publish conflict, or you want the
# current local repo to fully resync as the authoritative target
./local-repo/scripts/build-and-push.sh --sync kali-rolling
```

`--sync` creates a new snapshot, re-uploads and verifies every
referenced file, and uses the remote version that existed at sync
start as the commit predecessor. It does not auto-merge other
maintainers' packages. `--sync` can also replace an in-flight publish;
unreferenced old staging directories can be cleaned up once you are
sure you no longer want to resume them.

Releases use SHA256 and declare `Acquire-By-Hash: yes`. Package files,
snapshots, and old by-hash indexes stay immutable on the remote, so a
client that still holds the old `InRelease` can still fetch the
matching old index and package; only the canonical index URLs are
mutable and uncached. **Package content changes require a new
version/filename.** Removal only drops the package from new indexes;
old files are not auto-reclaimed, to avoid breaking in-flight
downloads.

Clients need to support `InRelease` and by-hash. Clients that disable by-hash or use
detached signatures only may catch a publish switch mid-update and
should re-run `apt update`.

## Migration and recovery

```bash
./local-repo/scripts/migrate-export.sh /safe/path/repository.tar.gz
./local-repo/scripts/migrate-import.sh /safe/path/repository.tar.gz
# → enter GPG passphrase once
# → config.env decrypted into local-repo/config.env
# → state dirs replaced; --sync auto-runs if dists/ has content
./local-repo/scripts/push.sh path/to/package.deb   # ready to go
```

Export covers only `keys/`, `conf/`, `db/`, `pool/`, `dists/` and
`config.env.gpg` — no token, no staging, no scripts. V2 backups record
a SHA256 per file. `INCLUDE_DISTS=0` skips
indexes; recover them later by re-running `migrate-import` on the same
archive. the script will skip `--sync` because `dists/` is empty.

Import extracts next to the target, refuses path traversal, links,
special files, and duplicate entries; only after verifying the
manifest, key fingerprint, decrypted private key, signature
self-check, and reprepro database references does it replace the
state subdirectories. `config.env` is decrypted into
`local-repo/config.env` so `push.sh` works immediately. The
old state and old publish staging are saved to
`<target>.bak.<unique-suffix>`. Catchable errors during the swap roll
back automatically; on power loss / SIGKILL, keep that backup and
recover by hand.

After `replace_state`, if the target's `dists/` already has content,
the import script automatically runs
`./local-repo/scripts/build-and-push.sh --sync kali-rolling` so the
remote state matches the imported repository. The same GPG passphrase
is piped in via stdin; a `--sync` failure is a warning, not a fatal
error — you may re-run `--sync` manually.

Both publisher and migration use a temporary isolated GPG keyring,
restoring the requested private key from the encrypted backup. They
do not depend on the new host's user keyring and never import private
keys globally. Passphrases go to GPG via stdin, and the temporary
agent is destroyed on exit. **No need to run `init.sh` on the target
machine** — `config.env` arrives via the archive.

## Regression tests

```bash
sudo apt-get install reprepro gnupg python3
python3 -m unittest discover -s local-repo/test -v
```

The tests use throwaway keys, repositories, and APT state. They cover
network-failure resume, lost-commit-response recovery, repo locks,
full re-upload, add/remove, migration rollback, plus real APT
signature verification and package download — without modifying system
sources or installing system packages.

## Custom `REPO_ROOT`

```bash
export CLOUD_APT_ROOT=/custom/path
./local-repo/scripts/init.sh
```

Avoid putting state under `$HOME` — the repo's state and the local
key material should be physically separated.