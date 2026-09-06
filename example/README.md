# example/hello

A 5-line C program packaged as a `.deb`, used to exercise the
`cloud-apt` repository end-to-end.

```
$ /usr/local/bin/hello
Hello, cloud-apt!
```

## Layout

| Path inside the package | Purpose |
|---|---|
| `/opt/hello-0.1.0/bin/hello` | The compiled binary |
| `/usr/local/bin/hello` | Symlink (created by `postinst`) |
| `/usr/share/doc/hello/copyright` | Apache-2.0 license |
| `/usr/share/doc/hello/changelog.gz` | Compressed changelog |

## Build the .deb (local, no container)

Requires `gcc` (or `cc`) and `dpkg-deb` on the host.

```bash
cd example
bash build-deb.sh
# → artifacts/hello_0.1.0-1_amd64.deb
```

## Build the .deb (containerized via `act` + podman)

For a production upstream project the upstream-deb-packager pipeline
applies: containerised build on `kalilinux/kali-rolling:latest`,
isolated toolchain, GitHub Actions workflow at
`.github/workflows/build-kali.yml`. Skipped here — overkill for a
hello-world.

## Install / remove

```bash
sudo apt install ./artifacts/hello_0.1.0-1_amd64.deb
hello
# → Hello, cloud-apt!
sudo apt remove hello
```

## Files

| File | Purpose |
|---|---|
| `hello.c` | The C source (5 lines, `printf`) |
| `Makefile` | `make` / `make install DESTDIR=…` |
| `debian/control` | Package metadata (name, version, depends) |
| `debian/postinst` | Creates `/usr/local/bin/hello` symlink |
| `debian/prerm` | Removes the symlink on `apt remove` |
| `debian/changelog` | `hello (0.1.0-1)` entry |
| `debian/copyright` | Apache-2.0 license |
| `build-deb.sh` | Single-step local builder |
| `artifacts/` | `.deb` output (gitignored) |