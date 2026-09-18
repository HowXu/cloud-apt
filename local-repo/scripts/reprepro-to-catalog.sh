#!/usr/bin/env bash
# One-shot: read Packages/Packages.gz from dists/ and emit a packages.json
# compatible with the new server-side design. Use this on a machine that
# still has dists/ + pool/ from a previous install.
#
# Usage: reprepro-to-catalog.sh [path/to/local-repo]
#        (defaults to ../local-repo relative to this script)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$SCRIPT_DIR/..}"

if [[ ! -d "$ROOT/dists" ]]; then
    echo "error: $ROOT/dists missing — nothing to migrate" >&2
    exit 1
fi

OUTPUT="$ROOT/packages.json"

python3 - "$ROOT" "$OUTPUT" <<'PY'
import gzip
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
output = Path(sys.argv[2])

PACKAGE_RE = re.compile(r'^Package: (.+)$', re.MULTILINE)
VERSION_RE = re.compile(r'^Version: (.+)$', re.MULTILINE)
ARCH_RE = re.compile(r'^Architecture: (.+)$', re.MULTILINE)
FILENAME_RE = re.compile(r'^Filename: (.+)$', re.MULTILINE)
SIZE_RE = re.compile(r'^Size: (\d+)$', re.MULTILINE)
SHA256_RE = re.compile(r'^SHA256: ([0-9a-f]{64})$', re.MULTILINE)

packages = []
seen = set()
for packages_file in sorted(root.glob('dists/*/main/binary-*/Packages*')):
    raw = packages_file.read_bytes()
    if packages_file.suffix == '.gz':
        try:
            text = gzip.decompress(raw).decode('utf-8', errors='replace')
        except OSError:
            continue
    else:
        text = raw.decode('utf-8', errors='replace')
    for block in text.split('\n\n'):
        if not block.strip():
            continue
        name = PACKAGE_RE.search(block)
        version = VERSION_RE.search(block)
        arch = ARCH_RE.search(block)
        filename = FILENAME_RE.search(block)
        size = SIZE_RE.search(block)
        sha = SHA256_RE.search(block)
        if not (name and version and arch and filename):
            continue
        if not filename.group(1).startswith('pool/'):
            continue
        entry = {
            'package': name.group(1).strip(),
            'version': version.group(1).strip(),
            'architecture': arch.group(1).strip(),
            'filename': filename.group(1).strip(),
            'size': int(size.group(1)) if size else 0,
            'sha256': sha.group(1).strip() if sha else '',
        }
        key = (entry['package'], entry['architecture'], entry['version'])
        if key in seen:
            continue
        seen.add(key)
        packages.append(entry)

output.write_text(json.dumps(packages, indent=2))
print(f'wrote {len(packages)} packages to {output}')
print('next: ./local-repo/scripts/push.sh --sync kali-rolling')
PY