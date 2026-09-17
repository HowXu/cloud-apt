# example/cloud-apt-info

A pure-Python companion example for `cloud-apt`. Distinct from
`cloud-apt-hello` in three ways: Python source (no compile), depends on
`python3`, and drops a config file under `/etc/cloud-apt`. Built by
`example/build.sh`.

## Why it exists alongside `cloud-apt-hello`

| Aspect | cloud-apt-hello | cloud-apt-info |
|---|---|---|
| Source language | C | Python 3 |
| Build step | `cc` compile | none |
| `Depends:` | `libc6` | `python3` |
| Config drop |  | `/etc/cloud-apt/info.json` |
| Symlink target | `/usr/local/bin/cloud-apt-hello` | `/usr/local/bin/cloud-apt-info` |

Use this example to verify `migrate-export` / `migrate-import` handle
multiple packages without mixing their pool paths.

## Build

The recommended way is the top-level `example/build.sh` — it places
every artifact under `example/artifacts/` so the build outputs are
visible at a glance:

```bash
cd example
./build.sh                     # builds both examples
./build.sh cloud-apt-info      # just this one
# → example/artifacts/cloud-apt-info_0.1.0-1_amd64.deb
```

If you only want this one and don't care about the shared artifacts
directory, you can also run `build-deb.sh` directly:

```bash
cd example/cloud-apt-info
bash build-deb.sh
# → cloud-apt-info/artifacts/cloud-apt-info_0.1.0-1_amd64.deb
```

## Install / remove

The path depends on which build mode you used. From the `example/`
parent (recommended):

```bash
sudo apt install ./artifacts/cloud-apt-info_0.1.0-1_amd64.deb
cloud-apt-info --version
# → cloud-apt-info 0.1.0
cloud-apt-info --config
# → {"installed_by": "cloud-apt", "package": "cloud-apt-info"}
sudo apt remove cloud-apt-info
```

## Files

| File | Purpose |
|---|---|
| `cloud-apt-info.py` | The Python script (argparse + json) |
| `Makefile` | `make install DESTDIR=…` (no compile) |
| `debian/control` | Package metadata (name, version, depends) |
| `debian/postinst` | Creates `/etc/cloud-apt/`, drops default config, symlinks `/usr/local/bin/cloud-apt-info` |
| `debian/prerm` | Removes the `/usr/local/bin` symlink |
| `debian/changelog` | `cloud-apt-info (0.1.0-1)` entry |
| `debian/copyright` | Apache-2.0 license |
| `build-deb.sh` | Single-step local builder (defaults to `./artifacts/`) |