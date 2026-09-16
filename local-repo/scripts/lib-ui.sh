#!/usr/bin/env bash
# Shared: output helpers (info/ok/warn/die).
# All helpers emit plain ASCII tags so logs stay portable across locales.
set -euo pipefail

info()  { printf '[INFO]  %s\n' "$*"; }
ok()    { printf '[OK]    %s\n' "$*"; }
warn()  { printf '[WARN]  %s\n' "$*" >&2; }
die()   { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
