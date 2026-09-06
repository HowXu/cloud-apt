# example/cloud-apt-hello

A 5-line C program packaged as a `.deb`, used to exercise the
`cloud-apt` repository end-to-end.

```
$ /usr/local/bin/cloud-apt-hello
Hello, cloud-apt!
```

## Layout

| Path inside the package | Purpose |
|---|---|
| `/opt/cloud-apt-hello-0.2.0/bin/cloud-apt-hello` | The compiled binary |
| `/usr/local/bin/cloud-apt-hello` | Symlink (created by `postinst`) |
| `/usr/share/doc/cloud-apt-hello/copyright` | Apache-2.0 license |
| `/usr/share/doc/cloud-apt-hello/changelog.gz` | Compressed changelog |

## Build the .deb (local, no container)

Requires `gcc` (or `cc`) and `dpkg-deb` on the host.

```bash
cd example
bash build-deb.sh
# → artifacts/cloud-apt-hello_0.2.0-1_amd64.deb
```

## Build the .deb (containerized via `act` + podman)

For a production upstream project the upstream-deb-packager pipeline
applies: containerised build on `kalilinux/kali-rolling:latest`,
isolated toolchain, GitHub Actions workflow at
`.github/workflows/build-kali.yml`. Skipped here — overkill for a
hello-world.

## Install / remove

```bash
sudo apt install ./artifacts/cloud-apt-hello_0.2.0-1_amd64.deb
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
| `debian/changelog` | `cloud-apt-hello (0.2.0-1)` entry |
| `debian/copyright` | Apache-2.0 license |
| `build-deb.sh` | Single-step local builder |
| `artifacts/` | `.deb` output (gitignored) |
