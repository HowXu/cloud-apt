# example/cloud-apt-hello

A 5-line C program packaged as a `.deb`, used to exercise the
`cloud-apt` repository end-to-end. Built by `example/build.sh`.

```
$ /usr/local/bin/cloud-apt-hello
Hello, cloud-apt!
```

## Layout

| Path inside the package | Purpose |
|---|---|
| `/opt/cloud-apt-hello-0.2.1/bin/cloud-apt-hello` | The compiled binary |
| `/usr/local/bin/cloud-apt-hello` | Symlink (created by `postinst`) |
| `/usr/share/doc/cloud-apt-hello/copyright` | Apache-2.0 license |
| `/usr/share/doc/cloud-apt-hello/changelog.gz` | Compressed changelog |

## Build

The recommended way is the top-level `example/build.sh` — it places
every artifact under `example/artifacts/` so the build outputs are
visible at a glance:

```bash
cd example
./build.sh                       # builds both examples
./build.sh cloud-apt-hello       # just this one
# → example/artifacts/cloud-apt-hello_0.2.1-1_amd64.deb
```

If you only want this one and don't care about the shared artifacts
directory, you can also run `build-deb.sh` directly:

```bash
cd example/cloud-apt-hello
bash build-deb.sh
# → cloud-apt-hello/artifacts/cloud-apt-hello_0.2.1-1_amd64.deb
```

Requires `gcc` (or `cc`) and `dpkg-deb` on the host.

## Containerized build (skipped)

For a production upstream project the upstream-deb-packager pipeline
applies: containerised build on `kalilinux/kali-rolling:latest`,
isolated toolchain, GitHub Actions workflow at
`.github/workflows/build-kali.yml`. Skipped here — overkill for a
hello-world.

## Install / remove

The path depends on which build mode you used. From the `example/`
parent (recommended):

```bash
sudo apt install ./artifacts/cloud-apt-hello_0.2.1-1_amd64.deb
cloud-apt-hello
# → Hello, cloud-apt!
sudo apt remove cloud-apt-hello
```

## Files

| File | Purpose |
|---|---|
| `cloud-apt-hello.c` | The C source (5 lines, `printf`) |
| `Makefile` | `make` / `make install DESTDIR=…` |
| `debian/control` | Package metadata (name, version, depends) |
| `debian/postinst` | Creates `/usr/local/bin/cloud-apt-hello` symlink |
| `debian/prerm` | Removes the symlink on `apt remove` |
| `debian/changelog` | `cloud-apt-hello (0.2.1-1)` entry |
| `debian/copyright` | Apache-2.0 license |
| `build-deb.sh` | Single-step local builder (defaults to `./artifacts/`) |