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
            raise RuntimeError(f'缺少状态目录: {name}')
    for name in KEY_FILES:
        if not (root / 'keys' / name).is_file():
            raise RuntimeError(f'缺少密钥文件: {name}')
    if any(archive.is_relative_to(root / name) for name in STATE_DIRS):
        raise RuntimeError('备份输出不能位于被打包的状态子目录内')
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
                raise RuntimeError(f'状态目录不能是符号链接: {folder}')
            entries.append(folder)
            for path in sorted(folder.rglob('*')):
                if path.is_symlink() or not (path.is_file() or path.is_dir()):
                    raise RuntimeError(f'状态目录含链接或特殊文件: {path}')
                if name == 'keys' and path.relative_to(folder).as_posix() not in KEY_FILES:
                    continue  # Never export plaintext private-key leftovers.
                entries.append(path)
        manifest = {'magic': MAGIC, 'version': 2, 'gpg_fpr': fingerprint, 'include_dists': include_dists,
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
    print(f'✓ 导出完成: {archive}\nSHA256: {sha256(archive)}')


def extract_checked(archive, stage):
    """Validate every member before creating files; no symlinks, hardlinks or devices."""
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        names = set()
        for member in members:
            name = member.name.rstrip('/')
            top = PurePosixPath(name).parts[0] if name else ''
            if not safe_relative(name) or name in names or not (member.isfile() or member.isdir()) or (
                top not in STATE_DIRS and name != 'EXPORT-MANIFEST.json'):
                raise RuntimeError(f'备份含不安全或重复条目: {member.name}')
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
        raise RuntimeError('不支持的备份格式')
    for name in ('keys', 'conf', 'db', 'pool'):
        if not (stage / name).is_dir():
            raise RuntimeError(f'备份不完整: 缺少 {name}')
    if not (stage / 'conf/distributions').is_file():
        raise RuntimeError('备份缺少 conf/distributions')
    for name in KEY_FILES:
        if not (stage / 'keys' / name).is_file():
            raise RuntimeError(f'备份缺少 keys/{name}')
    # V1 imports remain supported; V2 additionally verifies all archived file bytes.
    if manifest.get('version') == 2:
        files = {p.relative_to(stage).as_posix(): p for p in stage.rglob('*')
                 if p.is_file() and p.name != 'EXPORT-MANIFEST.json'}
        if set(files) != set(manifest['files']):
            raise RuntimeError('备份文件清单不完整')
        for name, path in files.items():
            record = manifest['files'][name]
            if path.stat().st_size != record['size'] or sha256(path) != record['sha256']:
                raise RuntimeError(f'备份文件校验失败: {name}')
    if key_fingerprint(stage) != manifest.get('gpg_fpr', '').upper():
        raise RuntimeError('Manifest 与密钥指纹不一致')
    (stage / 'keys').chmod(0o700)
    for name in KEY_FILES:
        (stage / 'keys' / name).chmod(0o600)
    (stage / 'dists').mkdir(exist_ok=True)
    return manifest


def replace_state(target, stage, replace=os.replace):
    """Replace state directories only, and roll back all completed moves on failure."""
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
    except BaseException:
        for name in reversed(installed):
            os.replace(target / name, stage / name)
        for name in reversed(saved):
            os.replace(backup / name, target / name)
        raise
    return backup


def import_repository(archive, target, password, confirm=False):
    archive, target = Path(archive).resolve(), Path(target).resolve()
    if not archive.is_file():
        raise RuntimeError(f'找不到备份: {archive}')
    target.parent.mkdir(parents=True, exist_ok=True)
    with repo_lock(target):
        if confirm and any((target / name).exists() for name in ('keys', 'db', 'pool')):
            if input('替换仓库状态并备份旧状态？[y/N] ').lower() != 'y':
                raise RuntimeError('已取消')
        # Read/extract the entire archive before moving any target state.
        with tempfile.TemporaryDirectory(prefix='.cloud-apt-import-', dir=target.parent) as directory:
            stage = Path(directory)
            extract_checked(archive, stage)
            with signing_home(stage, password):
                # Check database/pool references before replacing a healthy repository.
                checked = subprocess.run(['reprepro', '--basedir', str(stage), '--confdir', str(stage / 'conf'), 'check'],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if checked.returncode:
                    raise RuntimeError('备份仓库完整性检查失败: ' + checked.stderr.decode(errors='replace'))
            backup = replace_state(target, stage)
    print(f'✓ 导入完成并通过签名自检: {target}\n旧状态备份: {backup}')
    print(f'后续发布设置 CLOUD_APT_ROOT={target}；发布器会从 keys/ 恢复隔离的签名环境。')
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['export', 'import'])
    parser.add_argument('archive', nargs='?')
    parser.add_argument('target', nargs='?')
    args = parser.parse_args()
    root = Path(os.environ.get('CLOUD_APT_ROOT', Path(__file__).resolve().parents[1])).resolve()
    if args.mode == 'export':
        archive = args.archive or str(root / ('cloud-apt-export-' + uuid.uuid4().hex + '.tar.gz'))
        export_repository(root, archive, os.environ.get('INCLUDE_DISTS') != '0')
    else:
        if not args.archive:
            parser.error('导入需要备份路径')
        password = os.environ.get('GPG_PASSPHRASE') or getpass.getpass('GPG passphrase: ')
        import_repository(args.archive, args.target or root, password, os.environ.get('YES') != '1')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, tarfile.TarError) as error:
        print(f'✗ {error}', file=sys.stderr)
        sys.exit(1)
