#!/usr/bin/env bash
# Build all .deb examples in this directory and place every artifact under
# ./artifacts/ so the build outputs are visible at a glance.
#
# Usage:
#   ./build.sh                                       # build every example
#   ./build.sh cloud-apt-hello                       # build only one
#   ./build.sh cloud-apt-info cloud-apt-hello        # explicit order
#
# Each example must expose ./<name>/build-deb.sh. The directory name == the
# Debian package name (1:1), so a single grep links the artifact path to its
# source tree. Each build-deb.sh respects $EXAMPLE_ARTIFACTS so the parent
# script can redirect all output to ./artifacts/ here.
set -euo pipefail
cd "$(dirname "$0")"

EXAMPLES=(cloud-apt-hello cloud-apt-info)
if [[ $# -gt 0 ]]; then
    EXAMPLES=("$@")
fi

export EXAMPLE_ARTIFACTS="$PWD/artifacts"
mkdir -p "$EXAMPLE_ARTIFACTS"

for example in "${EXAMPLES[@]}"; do
    if [[ ! -d "$example" ]]; then
        printf 'error: %s is not a directory\n' "$example" >&2
        exit 1
    fi
    if [[ ! -x "$example/build-deb.sh" ]]; then
        printf 'error: %s/build-deb.sh missing or not executable\n' "$example" >&2
        exit 1
    fi
    printf '\n==> Building %s\n' "$example"
    "$example/build-deb.sh"
done

printf '\n==> Built artifacts:\n'
find "$EXAMPLE_ARTIFACTS" -name '*.deb' -type f | sort
printf '\nDone.\n'