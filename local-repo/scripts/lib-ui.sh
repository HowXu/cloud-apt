#!/usr/bin/env bash
# 共用：输出提示与错误
set -euo pipefail

info()  { printf '→ %s\n' "$*"; }
ok()    { printf '✓ %s\n' "$*"; }
warn()  { printf '⚠ %s\n' "$*" >&2; }
die()   { printf '✗ %s\n' "$*" >&2; exit 1; }
