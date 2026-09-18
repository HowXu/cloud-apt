"""Bundle keys + packages.json + (optional) signed dists/ for portable migration.

The local-repo/ carries only the GPG keypair, conf/distributions, the
packages.json catalog, and the most recent signed dists/ snapshot. The
remote R2 bucket already owns the immutable pool/ files; we never move
those over the wire.
"""
import argparse
import getpass
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid

from repo_state import key_fingerprint, repo_lock, safe_relative, sha256, signing_home


MAGIC = 'CLOUD-APT-EXPORT-V2'
STATE_DIRS = ('keys', 'conf', 'dists')
KEY_FILES = ('public.key', 'private.key.gpg', 'keyid.txt')
CATALOG_FILE = 'packages.json'


def _populate_config_env_gpg(root: Path, public_key_path: Path, config_env: Path) -> Path | None:
    """Encrypt config.env with the repo's public key into config.env.gpg; return path or None."""
    if not config_env.is_file() or config_env.is_symlink():
        return None
    keyid_txt = (root / 'keys' / 'keyid.txt').read_text()
    email = next((line.split('=', 1)[1] for line in keyid_txt.splitlines()
                  if line.startswith('EMAIL=')), None)
    if not email:
        return None
    fingerprint = key_fingerprint(root)
    out_path = root / 'config.env.gpg'
    with tempfile.TemporaryDirectory(prefix='cloud-apt-export-gpg-') as home:
        home_path = Path(home)
        home_path.chmod(0o700)
        try:
            subprocess.run([
                'gpg', '--homedir', str(home_path), '--batch', '--yes',
                '--import', str(public_key_path),
            ], check=True, capture_output=True)
            listing = subprocess.run([
                'gpg', '--homedir', str(home_path), '--batch', '--yes',
                '--with-colons', '--list-keys', '--with-keygrip',
            ], capture_output=True).stdout.decode()
            has_encr = any(
                line.startswith('sub:') and 'e' in (line.split(':')[11] or '')
                for line in listing.splitlines()
            )
            if not has_encr:
                print(
                    f'warning: keys/public.key has no encryption-capable subkey; '
                    f'config.env will not be in the archive. '
                    f'To fix on this machine:\n'
                    f'  gpg --homedir <homedir> --batch --yes --pinentry-mode loopback '
                    f'--passphrase-fd 0 --quick-add-key {fingerprint} cv25519 encr 0 '
                    f'<<<$GPG_PASSPHRASE\n'
                    f'Then re-export.',
                    file=sys.stderr)
                return None
            subprocess.run([
                'gpg', '--homedir', str(home_path), '--batch', '--yes',
                '--trust-model', 'always',
                '--output', str(out_path),
                '--encrypt', '--recipient', email,
                str(config_env),
            ], check=True, capture_output=True)
            return out_path
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            return None


def export_repository(root, archive, include_dists=True):
    root = Path(root).resolve()
    archive = Path(archive).resolve()
    if not (root / 'keys').is_dir():
        raise RuntimeError('missing state directory: keys')
    if not (root / 'conf').is_dir():
        raise RuntimeError('missing state directory: conf')
    for name in KEY_FILES:
        if not (root / 'keys' / name).is_file():
            raise RuntimeError(f'missing key file: {name}')
    catalog_path = root / CATALOG_FILE
    if catalog_path.is_file() and catalog_path.is_symlink():
        raise RuntimeError('packages.json cannot be a symlink')
    if any(archive.is_relative_to(root / name) for name in STATE_DIRS):
        raise RuntimeError('archive output cannot be inside a packed state subdirectory')
    with repo_lock(root):
        fingerprint = key_fingerprint(root)
        entries = []
        for name in STATE_DIRS:
            folder = root / name
            if not folder.exists():
                continue
            if folder.is_symlink():
                raise RuntimeError(f'state directory cannot be a symlink: {folder}')
            entries.append(folder)
            for path in sorted(folder.rglob('*')):
                if path.is_symlink() or not (path.is_file() or path.is_dir()):
                    raise RuntimeError(f'state directory contains links or special files: {path}')
                if name == 'keys' and path.relative_to(folder).as_posix() not in KEY_FILES:
                    continue
                entries.append(path)
        if catalog_path.is_file():
            entries.append(catalog_path)
        config_env_gpg = None
        config_env_path = root / 'config.env'
        if config_env_path.is_file() and not config_env_path.is_symlink():
            config_env_gpg = _populate_config_env_gpg(root, root / 'keys' / 'public.key', config_env_path)
            if config_env_gpg:
                entries.append(config_env_gpg)
        manifest = {
            'magic': MAGIC, 'version': 1,
            'gpg_fpr': fingerprint, 'include_dists': include_dists,
            'has_config': config_env_gpg is not None,
            'files': {p.relative_to(root).as_posix(): {'sha256': sha256(p), 'size': p.stat().st_size}
                      for p in entries if p.is_file()},
        }
        archive.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.cloud-apt-export-', dir=archive.parent)
        os.close(fd)
        try:
            with tarfile.open(temporary, 'w:gz') as output:
                payload = json.dumps(manifest).encode()
                header = tarfile.TarInfo('EXPORT-MANIFEST.json')
                header.size, header.mode = len(payload), 0o600
                output.addfile(header, io.BytesIO(payload))
                for path in entries:
                    output.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
            os.chmod(temporary, 0o600)
            os.replace(temporary, archive)
        finally:
            Path(temporary).unlink(missing_ok=True)
            if config_env_gpg and config_env_gpg.exists():
                config_env_gpg.unlink()
    print(f'export complete: {archive}\nSHA256: {sha256(archive)}')


def extract_checked(archive, stage):
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        names = set()
        allowed_roots = set(STATE_DIRS) | {CATALOG_FILE, 'EXPORT-MANIFEST.json', 'config.env.gpg'}
        for member in members:
            name = member.name.rstrip('/')
            if not safe_relative(name) or name in names or not (member.isfile() or member.isdir()):
                raise RuntimeError(f'archive contains unsafe or duplicate entry: {member.name}')
            top = name.split('/', 1)[0]
            if top not in allowed_roots:
                raise RuntimeError(f'archive contains unsafe top-level entry: {member.name}')
            names.add(name)
        for member in members:
            target = stage / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, target.open('xb') as output:
                    shutil.copyfileobj(incoming, output)
                target.chmod(member.mode & 0o777)
    manifest = json.loads((stage / 'EXPORT-MANIFEST.json').read_text())
    if manifest.get('magic') != MAGIC:
        raise RuntimeError('unsupported archive format')
    if not (stage / 'keys').is_dir():
        raise RuntimeError('archive incomplete: missing keys')
    if not (stage / 'conf').is_dir():
        raise RuntimeError('archive incomplete: missing conf')
    if not (stage / 'conf/distributions').is_file():
        raise RuntimeError('archive missing conf/distributions')
    for name in KEY_FILES:
        if not (stage / 'keys' / name).is_file():
            raise RuntimeError(f'archive missing keys/{name}')
    files = {p.relative_to(stage).as_posix(): p for p in stage.rglob('*')
             if p.is_file() and p.name != 'EXPORT-MANIFEST.json'}
    if set(files) != set(manifest['files']):
        raise RuntimeError('archive file list incomplete')
    for name, path in files.items():
        record = manifest['files'][name]
        if path.stat().st_size != record['size'] or sha256(path) != record['sha256']:
            raise RuntimeError(f'archive file checksum failed: {name}')
    if key_fingerprint(stage) != manifest.get('gpg_fpr', '').upper():
        raise RuntimeError('manifest fingerprint does not match keyid')
    (stage / 'keys').chmod(0o700)
    for name in KEY_FILES:
        (stage / 'keys' / name).chmod(0o600)
    (stage / 'dists').mkdir(exist_ok=True)
    return manifest


def replace_state(target, stage, replace=os.replace):
    """Replace keys/, conf/, dists/, packages.json, config.env under local-repo/.
    Roll back every completed move if anything raises."""
    local_repo = target / 'local-repo'
    backup = target.parent / (target.name + '.bak.' + uuid.uuid4().hex)
    backup.mkdir(mode=0o700)
    local_repo.mkdir(parents=True, exist_ok=True)
    saved, installed = [], []
    try:
        template = local_repo / 'conf/distributions.template'
        if template.is_file():
            shutil.copyfile(template, stage / 'conf/distributions.template')
        # In-flight uploads belong to the prior packages.json and cannot survive a migration.
        for transient in ('.publish',):
            current = local_repo / transient
            if current.exists():
                replace(current, backup / transient)
                saved.append(transient)
        for name in STATE_DIRS:
            current = local_repo / name
            if current.exists():
                replace(current, backup / name)
                saved.append(name)
            current.parent.mkdir(parents=True, exist_ok=True)
            replace(stage / name, current)
            installed.append(name)
        # packages.json
        catalog_dst = stage / CATALOG_FILE
        current_catalog = local_repo / CATALOG_FILE
        if catalog_dst.is_file():
            if current_catalog.exists():
                replace(current_catalog, backup / CATALOG_FILE)
                saved.append(CATALOG_FILE)
            replace(catalog_dst, current_catalog)
            installed.append(CATALOG_FILE)
        # config.env (decrypted into stage/config.env by import_repository)
        config_env_dst = stage / 'config.env'
        local_config_env = local_repo / 'config.env'
        if config_env_dst.is_file():
            local_config_env.parent.mkdir(parents=True, exist_ok=True)
            if local_config_env.exists():
                replace(local_config_env, backup / 'config.env')
                saved.append('config.env')
            replace(config_env_dst, local_config_env)
            installed.append('config.env')
    except BaseException:
        for name in reversed(installed):
            os.replace(local_repo / name, stage / name)
        for name in reversed(saved):
            os.replace(backup / name, local_repo / name)
        raise
    return backup


def import_repository(archive, target, password, confirm=False):
    archive = Path(archive).resolve()
    target = Path(target).resolve()
    if not archive.is_file():
        raise RuntimeError(f'archive not found: {archive}')
    target.parent.mkdir(parents=True, exist_ok=True)
    with repo_lock(target):
        if confirm and any((target / 'local-repo' / name).exists()
                           for name in (*STATE_DIRS, CATALOG_FILE)):
            if input('replace repo state and back up the old state? [y/N] ').lower() != 'y':
                raise RuntimeError('cancelled')
        with tempfile.TemporaryDirectory(prefix='.cloud-apt-import-', dir=target.parent) as directory:
            stage = Path(directory)
            manifest = extract_checked(archive, stage)
            with signing_home(stage, password) as (home, fingerprint):
                # Decrypt config.env.gpg if present.
                config_env_gpg = stage / 'config.env.gpg'
                if config_env_gpg.is_file():
                    decrypted = subprocess.run([
                        'gpg', '--homedir', str(home), '--batch', '--yes',
                        '--output', str(stage / 'config.env'),
                        '--decrypt', str(config_env_gpg),
                    ], capture_output=True)
                    if decrypted.returncode == 0:
                        (stage / 'config.env').chmod(0o600)
                    else:
                        print(f'warning: config.env.gpg decrypt failed '
                              f'({decrypted.stderr.decode(errors="replace")[:200]}); '
                              f'set ADMIN_PUSH_TOKEN manually', file=sys.stderr)
            backup = replace_state(target, stage)
    print(f'import complete: {target}\nold state backup: {backup}')
    print(f'run sync after import to push packages.json to the server: '
          f'CLOUD_APT_ROOT={target} ./push.sh --sync {manifest.get("suite", "kali-rolling")}')
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['export', 'import'])
    parser.add_argument('archive', nargs='?')
    parser.add_argument('target', nargs='?')
    args = parser.parse_args()
    here = Path(__file__).resolve()
    local_repo = here.parents[1]
    repo_root = here.parents[2]
    if args.mode == 'export':
        root = Path(os.environ.get('CLOUD_APT_ROOT', local_repo)).resolve()
        archive = args.archive or str(root / ('cloud-apt-export-' + uuid.uuid4().hex + '.tar.gz'))
        export_repository(root, archive, os.environ.get('INCLUDE_DISTS') != '0')
    else:
        if not args.archive:
            parser.error('import requires a backup path')
        password = os.environ.get('GPG_PASSPHRASE') or getpass.getpass('GPG passphrase: ')
        target = Path(args.target or os.environ.get('CLOUD_APT_ROOT', repo_root)).resolve()
        import_repository(args.archive, target, password, os.environ.get('YES') != '1')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, tarfile.TarError) as e:
        print(f'error: {e}', file=sys.stderr)
        sys.exit(1)