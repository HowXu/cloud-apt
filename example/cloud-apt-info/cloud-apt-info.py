#!/usr/bin/env python3
"""cloud-apt-info: companion example for cloud-apt migration testing.

This package exercises a different code path than cloud-apt-hello:
  * Python source (no compile step), so the .deb carries a text script
  * Depends on the system python3 interpreter
  * Has a runtime config file under /etc, so postinst must create a dir

Use this to verify migrate-export / migrate-import handle multiple packages
without merging their pool paths or skipping non-C binaries.
"""
import argparse
import json
import os
import sys

VERSION = "0.1.0"
CONFIG_PATH = "/etc/cloud-apt/info.json"


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {"installed_by": "unknown", "package": "cloud-apt-info"}
    with open(CONFIG_PATH) as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(
        prog="cloud-apt-info",
        description="Companion example for cloud-apt; prints version, repo hint, or runtime config.",
    )
    parser.add_argument("--version", action="store_true", help="show version")
    parser.add_argument("--repo", action="store_true", help="show repo verification hint")
    parser.add_argument("--config", action="store_true", help="dump runtime config from /etc")
    parser.add_argument("--health", action="store_true", help="exit 0 if runtime config readable")
    args = parser.parse_args()

    if args.version:
        print(f"cloud-apt-info {VERSION}")
        return 0
    if args.repo:
        print("Verify origin: apt-cache policy cloud-apt-info | grep -i candidate")
        return 0
    if args.config:
        print(json.dumps(load_config(), indent=2))
        return 0
    if args.health:
        try:
            load_config()
            return 0
        except (OSError, ValueError) as e:
            print(f"unhealthy: {e}", file=sys.stderr)
            return 1
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())