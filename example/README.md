# example/

Sample packages for end-to-end testing of `cloud-apt`. Each example is a
self-contained source tree whose name matches the Debian package it
produces (1:1). Build everything from this directory and the resulting
`.deb` files all land in `artifacts/` here, so a single `ls` shows the
full build output.

## Layout

```
example/
├── build.sh               # Builds every example; writes to ./artifacts/
├── README.md              # this file
├── artifacts/             # All .deb outputs land here (gitignored)
├── cloud-apt-hello/       # cloud-apt-hello_*.deb (C, libc6)
│   ├── cloud-apt-hello.c
│   ├── Makefile, build-deb.sh, README.md
│   └── debian/            # control, copyright, changelog, postinst, prerm
└── cloud-apt-info/        # cloud-apt-info_*.deb (Python, python3)
    ├── cloud-apt-info.py
    ├── Makefile, build-deb.sh, README.md
    └── debian/            # control, copyright, changelog, postinst, prerm
```

## Build

```bash
cd example
./build.sh                                       # build both, outputs to artifacts/
./build.sh cloud-apt-hello                       # only hello
./build.sh cloud-apt-info cloud-apt-hello        # explicit order
```

Each example's `build-deb.sh` can also be run on its own (defaults to
writing to `./artifacts/` relative to the example dir):

```bash
cd cloud-apt-hello && bash build-deb.sh
```

The two examples are intentionally different — see
`cloud-apt-info/README.md` for the side-by-side comparison. Together
they exercise the repo with multiple packages and a mix of build
systems, useful for verifying `migrate-export` / `migrate-import`.