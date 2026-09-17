"""Export/import repository state without replacing the installed tools."""
import argparse
import getpass
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid

from repo_state import key_fingerprint, repo_lock, safe_relative, sha256, signing_home

STATE_DIRS = ('keys', 'conf', 'db', 'pool', 'dists')
KEY_FILES = ('public.key', 'private.key.gpg', 'keyid.txt')
MAGIC = 'CLOUD-APT-EXPORT-V1'


def export_repository(root, archive, include_dists=True):
    root, archive = Path(root).resolve(), Path(archive).resolve()
    for name in ('keys', 'conf', 'db', 'pool'):
        if not (root / name).is_dir():
            raise RuntimeError(f'missing state directory: {name}')
    for name in KEY_FILES:
        if not (root / 'keys' / name).is_file():
            raise RuntimeError(f'missing key file: {name}')
    if any(archive.is_relative_to(root / name) for name in STATE_DIRS):
        raise RuntimeError('archive output cannot be inside a packed state subdirectory')
    with repo_lock(root):
        fingerprint = key_fingerprint(root)
        entries = []
        for name in STATE_DIRS:
            if name == 'dists' and not include_dists:
                continue
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
                    continue  # Never export plaintext private-key leftovers.
                entries.append(path)
        config_env = root / 'config.env'
        config_env_gpg = None
        if config_env.is_file() and not config_env.is_symlink():
            keyid_txt = (root / 'keys' / 'keyid.txt').read_text()
            email = next((line.split('=', 1)[1] for line in keyid_txt.splitlines()
                          if line.startswith('EMAIL=')), None)
            if email:
                fingerprint = key_fingerprint(root)
                config_env_gpg = root / 'config.env.gpg'
                with tempfile.TemporaryDirectory(prefix='cloud-apt-export-gpg-') as keyring_home:
                    keyring_home_path = Path(keyring_home)
                    keyring_home_path.chmod(0o700)
                    try:
                        subprocess.run([
                            'gpg', '--homedir', str(keyring_home_path), '--batch', '--yes',
                            '--import', str(root / 'keys' / 'public.key'),
                        ], check=True, capture_output=True)
                        # Check whether any key in this keyring has encryption capability
                        cap_listing = subprocess.run([
                            'gpg', '--homedir', str(keyring_home_path), '--batch', '--yes',
                            '--with-colons', '--list-keys', '--with-keygrip',
                        ], capture_output=True).stdout.decode()
                        has_encr = any(
                            line.startswith('sub:') and 'e' in (line.split(':')[11] or '')
                            for line in cap_listing.splitlines()
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
                            config_env_gpg = None
                        else:
                            subprocess.run([
                                'gpg', '--homedir', str(keyring_home_path), '--batch', '--yes',
                                '--trust-model', 'always',
                                '--output', str(config_env_gpg),
                                '--encrypt', '--recipient', email,
                                str(config_env),
                            ], check=True, capture_output=True)
                            entries.append(config_env_gpg)
                    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                        config_env_gpg = None
        manifest = {'magic': MAGIC, 'version': 2, 'gpg_fpr': fingerprint, 'include_dists': include_dists,
                    'has_config': config_env_gpg is not None,
                    'files': {p.relative_to(root).as_posix(): {'sha256': sha256(p), 'size': p.stat().st_size}
                              for p in entries if p.is_file()}}
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
    """Validate every member before creating files; no symlinks, hardlinks or devices."""
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        names = set()
        for member in members:
            name = member.name.rstrip('/')
            top = PurePosixPath(name).parts[0] if name else ''
            if not safe_relative(name) or name in names or not (member.isfile() or member.isdir()) or (
                top not in STATE_DIRS and name != 'EXPORT-MANIFEST.json' and name != 'config.env.gpg'):
                raise RuntimeError(f'archive contains unsafe or duplicate entry: {member.name}')
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
    if manifest.get('magic') != MAGIC or manifest.get('version', 1) not in (1, 2):
        raise RuntimeError('unsupported archive format')
    for name in ('keys', 'conf', 'db', 'pool'):
        if not (stage / name).is_dir():
            raise RuntimeError(f'archive incomplete: missing {name}')
    if not (stage / 'conf/distributions').is_file():
        raise RuntimeError('archive missing conf/distributions')
    for name in KEY_FILES:
        if not (stage / 'keys' / name).is_file():
            raise RuntimeError(f'archive missing keys/{name}')
    # V1 imports remain supported; V2 additionally verifies all archived file bytes.
    if manifest.get('version') == 2:
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
    """Replace state directories only, and roll back all completed moves on failure."""
    local_repo = target / 'local-repo'
    backup = target.parent / (target.name + '.bak.' + uuid.uuid4().hex)
    backup.mkdir(mode=0o700)
    saved, installed = [], []
    try:
        # Retain the installed source template, even when importing an older backup.
        template = target / 'conf/distributions.template'
        if template.is_file():
            shutil.copyfile(template, stage / 'conf/distributions.template')
        # Local pending uploads belong to the old DB and must not survive a migration.
        for name in (*STATE_DIRS, '.publish'):
            current = target / name
            if current.exists():
                replace(current, backup / name)
                saved.append(name)
            if name != '.publish':
                replace(stage / name, current)
                installed.append(name)
        # config.env decrypts into stage/; install it into local-repo/ alongside
        # the scripts that read it. Roll back via the same installed list.
        config_env_dst = local_repo / 'config.env'
        config_env_src = stage / 'config.env'
        if config_env_src.is_file():
            config_env_dst.parent.mkdir(parents=True, exist_ok=True)
            if config_env_dst.exists():
                replace(config_env_dst, backup / 'config.env')
                saved.append('config.env')
            replace(config_env_src, config_env_dst)
            installed.append('config.env')
    except BaseException:
        # config.env lives under local_repo, not directly under target.
        for name in reversed(installed):
            location = local_repo if name == 'config.env' else target
            os.replace(location / name, stage / name)
        for name in reversed(saved):
            location = local_repo if name == 'config.env' else target
            os.replace(backup / name, location / name)
        raise
    return backup


def post_import_sync(repo_root, password):
    """Re-sign and re-upload to align an existing dists/ with the remote.
    No-op when dists/ is missing/empty or build-and-push.sh is absent."""
    dists = repo_root / 'dists'
    if not dists.exists() or not any(dists.iterdir()):
        return
    script = repo_root / 'local-repo' / 'scripts' / 'build-and-push.sh'
    if not script.is_file():
        return  # partial repo (e.g. test fixture); user can run --sync manually
    local_repo = repo_root / 'local-repo'
    try:
        proc = subprocess.Popen(
            ['bash', '-c',
             '. "$1/scripts/lib-config.sh" && load_config && '
             'export CLOUD_APT_ROOT="$2" WORKER_URL ADMIN_PUSH_TOKEN && '
             'exec "$1/scripts/build-and-push.sh" --sync kali-rolling',
             '_', str(local_repo), str(repo_root)],
            cwd=str(repo_root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as error:
        print(f'warning: post-import --sync could not start ({error}); you may run it manually',
              file=sys.stderr)
        return
    stdout, stderr = proc.communicate(input=(password + '\n').encode())
    if proc.returncode != 0:
        message = stderr.decode(errors='replace')[:500] or stdout.decode(errors='replace')[:500]
        print(f'warning: post-import --sync failed (exit {proc.returncode}); you may run it manually\n  {message}',
              file=sys.stderr)


def import_repository(archive, target, password, confirm=False):
    archive, target = Path(archive).resolve(), Path(target).resolve()
    if not archive.is_file():
        raise RuntimeError(f'archive not found: {archive}')
    target.parent.mkdir(parents=True, exist_ok=True)
    with repo_lock(target):
        if confirm and any((target / name).exists() for name in ('keys', 'db', 'pool')):
            if input('replace repo state and back up the old state? [y/N] ').lower() != 'y':
                raise RuntimeError('cancelled')
        # Read/extract the entire archive before moving any target state.
        with tempfile.TemporaryDirectory(prefix='.cloud-apt-import-', dir=target.parent) as directory:
            stage = Path(directory)
            extract_checked(archive, stage)
            with signing_home(stage, password) as (home, fingerprint):
                # Check database/pool references before replacing a healthy repository.
                checked = subprocess.run(['reprepro', '--basedir', str(stage), '--confdir', str(stage / 'conf'), 'check'],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if checked.returncode:
                    raise RuntimeError('archive repository integrity check failed: ' + checked.stderr.decode(errors='replace'))
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
                        print(f'warning: config.env.gpg decrypt failed ({decrypted.stderr.decode(errors="replace")[:200]}); set ADMIN_PUSH_TOKEN manually', file=sys.stderr)
            backup = replace_state(target, stage)
            dists = target / 'dists'
            if dists.exists() and any(dists.iterdir()):
                post_import_sync(target, password)
    print(f'import complete with signature self-check: {target}\nold state backup: {backup}')
    print(f'for subsequent publishing set CLOUD_APT_ROOT={target}; the publisher restores an isolated signing environment from keys/')
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
    except (RuntimeError, ValueError, KeyError, OSError, tarfile.TarError) as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
