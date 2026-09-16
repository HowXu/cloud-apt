"""Build/resume immutable APT publications; commit only verified complete snapshots."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

from repo_state import atomic_json, gpg, repo_lock, safe_relative, sha256, signing_home


class Remote:
    def __init__(self, url, token):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('WORKER_URL 必须是 HTTPS 地址')
        self.url, self.token = url.rstrip('/'), token

    def request(self, method, path, data=None, headers=None):
        headers = dict(headers or {})
        headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=120) as response:
                return response.read(), response.headers
        except urllib.error.HTTPError as error:
            detail = error.read(4096).decode(errors='replace')
            raise RuntimeError(f'{method} {path}: HTTP {error.code}: {detail}') from None

    def current(self, suite):
        body, _ = self.request('GET', f'/api/publish/{suite}')
        return json.loads(body)

    def upload(self, root, record):
        path = root / record['local']
        if path.stat().st_size != record['size'] or sha256(path) != record['sha256']:
            raise RuntimeError(f'待发布快照被修改: {path}')
        with path.open('rb') as body:
            _, headers = self.request('PUT', '/api/upload/' + urllib.parse.quote(record['key'], safe='/'), body, {
                'Content-Type': 'application/octet-stream', 'Content-Length': str(record['size']),
                'X-Content-SHA256': record['sha256'],
            })
        if headers.get('X-Content-SHA256') != record['sha256']:
            raise RuntimeError('服务器未确认 SHA256；请先部署新版 Worker')

    def commit(self, state):
        data = {key: state[key] for key in ('release', 'previous')}
        data['files'] = [{key: f[key] for key in ('key', 'size', 'sha256')} for f in state['files']]
        self.request('POST', '/api/publish/' + state['suite'], json.dumps(data).encode(), {'Content-Type': 'application/json'})


def release_entries(text):
    entries, section = [], ''
    for line in text.splitlines():
        if line.startswith(' '):
            if section == 'SHA256':
                digest, size, name = line.split()
                if not safe_relative(name) or not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
                    raise RuntimeError('Release 包含不安全路径或错误哈希')
                entries.append((name, digest.lower(), int(size)))
        elif ':' in line:
            section = line.split(':', 1)[0]
    if not entries:
        raise RuntimeError('Release 缺少 SHA256 索引')
    return entries


def prepare_snapshot(root, suite, destination, home, fingerprint, password):
    source = root / 'dists' / suite
    target = destination / 'indexes'
    target.mkdir()
    text = (source / 'Release').read_text()
    entries = release_entries(text)
    text = re.sub(r'^Acquire-By-Hash:.*\n?', '', text, flags=re.MULTILINE)
    # Advertise precisely the algorithm for which we retain immutable by-hash files.
    text = re.sub(r'^(?:MD5Sum|SHA1|SHA256|SHA512):\n(?:[ \t].*\n?)*', '', text, flags=re.MULTILINE)
    text = 'Acquire-By-Hash: yes\n' + text.rstrip() + '\nSHA256:\n'
    text += ''.join(f' {digest} {size} {name}\n' for name, digest, size in entries)
    (target / 'Release').write_text(text)
    records, packages = [], {}
    for name, digest, size in entries:
        original = source / name
        if original.stat().st_size != size or sha256(original) != digest:
            raise RuntimeError(f'Release 与索引不一致: {name}')
        copied = target / name
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, copied)
        records.append((f'dists/{suite}/{Path(name).parent.as_posix()}/by-hash/SHA256/{digest}', copied))
        if Path(name).name == 'Packages':
            for block in copied.read_text().split('\n\n'):
                fields = dict(line.split(': ', 1) for line in block.splitlines() if ': ' in line and not line.startswith(' '))
                if not fields:
                    continue
                filename = fields.get('Filename', '')
                if not safe_relative(filename) or not filename.startswith('pool/') or not fields.get('SHA256'):
                    raise RuntimeError('Packages 缺少安全的 Filename / SHA256')
                expected = (fields['SHA256'], int(fields['Size']))
                if filename in packages and packages[filename] != expected:
                    raise RuntimeError('同一路径引用了不同的软件包')
                packages[filename] = expected
    if not any(Path(name).name == 'Packages' for name, _, _ in entries):
        raise RuntimeError('需要 reprepro 导出未压缩 Packages 以验证包引用')
    for filename, (digest, size) in packages.items():
        original = root / filename
        if original.stat().st_size != size or sha256(original) != digest:
            raise RuntimeError(f'缺失或损坏的软件包: {filename}')
        copied = destination / filename
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, copied)
        records.append((filename, copied))
    for name, option in [('InRelease', '--clearsign'), ('Release.gpg', '--detach-sign')]:
        gpg(home, ['--armor', '--local-user', fingerprint, '--output', target / name, option, target / 'Release'], password)
    gpg(home, ['--verify', target / 'InRelease'])
    gpg(home, ['--verify', target / 'Release.gpg', target / 'Release'])
    return target, records


def create_publication(root, suite, operation, remote, password):
    previous = remote.current(suite)['etag']
    with signing_home(root, password) as (home, fingerprint):
        # Export unsigned metadata; sign the final by-hash Release afterwards.
        with tempfile.TemporaryDirectory(prefix='cloud-apt-conf-') as directory:
            conf = Path(directory) / 'conf'
            shutil.copytree(root / 'conf', conf)
            dist = conf / 'distributions'
            dist.write_text(re.sub(r'^SignWith:.*\n?', '', dist.read_text(), flags=re.MULTILINE))
            command = ['reprepro', '--basedir', str(root), '--confdir', str(conf)]
            if operation['mode'] == 'include':
                subprocess.run(command + ['includedeb', suite, operation['deb']], check=True)
            elif operation['mode'] == 'remove':
                subprocess.run(command + ['remove', suite, operation['package']], check=True)
            subprocess.run(command + ['export', suite], check=True)
        store = root / '.publish'
        store.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='prepare-', dir=store) as directory:
            stage = Path(directory)
            release = uuid.uuid4().hex
            indexes, records = prepare_snapshot(root, suite, stage, home, fingerprint, password)
            records += [(f'dists/{suite}/.snapshots/{release}/{p.relative_to(indexes).as_posix()}', p)
                        for p in indexes.rglob('*') if p.is_file()]
            files = {key: {'key': key, 'local': path.relative_to(stage).as_posix(), 'sha256': sha256(path), 'size': path.stat().st_size}
                     for key, path in records}
            state = {'release': release, 'previous': previous, 'suite': suite, 'url': remote.url,
                     'operation': operation, 'files': sorted(files.values(), key=lambda f: (not f['key'].startswith('pool/'), f['key'])), 'uploaded': []}
            atomic_json(stage / 'state.json', state)
            snapshot = store / release
            os.replace(stage, snapshot)
            atomic_json(store / 'pending.json', {'release': release})
    return snapshot


def resume(snapshot, remote):
    path = snapshot / 'state.json'
    state = json.loads(path.read_text())
    if state['url'] != remote.url:
        raise RuntimeError('待发布快照属于另一 Worker，拒绝推送')
    for record in state['files']:
        if record['key'] in state['uploaded']:
            continue
        print('→ 上传并校验 ' + record['key'], flush=True)
        remote.upload(snapshot, record)
        state['uploaded'].append(record['key'])
        atomic_json(path, state)
    remote.commit(state)  # Idempotent even if the previous commit response was lost.
    atomic_json(snapshot.parent / 'last-success.json', {'release': state['release'], 'suite': state['suite']})
    (snapshot.parent / 'pending.json').unlink(missing_ok=True)
    shutil.rmtree(snapshot)  # Only local staging; remote history remains available.
    print(f"✓ 已完整发布 {state['suite']} ({state['release']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('arguments', nargs='*')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--remove', metavar='PACKAGE')
    modes.add_argument('--sync', action='store_true')
    modes.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    root = Path(os.environ.get('CLOUD_APT_ROOT', Path(__file__).resolve().parents[1])).resolve()
    remote = Remote(os.environ['WORKER_URL'], os.environ['ADMIN_PUSH_TOKEN'])
    if args.sync or args.remove or args.resume:
        suite = args.arguments[0] if args.arguments else 'kali-rolling'
        operation = {'mode': 'sync' if args.sync else 'remove' if args.remove else 'resume'}
        if args.remove:
            operation['package'] = args.remove
    else:
        if not args.arguments:
            parser.error('需要 .deb 路径，或 --sync / --resume / --remove')
        deb = Path(args.arguments[0]).resolve()
        suite = args.arguments[1] if len(args.arguments) > 1 else 'kali-rolling'
        operation = {'mode': 'include', 'deb': str(deb), 'sha256': sha256(deb)}
    if not re.fullmatch(r'[a-z0-9][a-z0-9.+~-]{0,63}', suite) or '..' in suite:
        raise ValueError('非法 suite')
    with repo_lock(root):
        pending = root / '.publish/pending.json'
        if pending.exists() and not args.sync:
            snapshot = pending.parent / json.loads(pending.read_text())['release']
            old = json.loads((snapshot / 'state.json').read_text())
            if old['suite'] != suite or (not args.resume and old['operation'] != operation):
                raise RuntimeError('存在另一批未完成发布。先使用 --resume [suite]，或 --sync [suite] 全量重新同步')
            resume(snapshot, remote)
            return
        if args.resume:
            raise RuntimeError('没有待恢复的发布')
        if args.remove and os.environ.get('YES') != '1' and input(f'移除 {args.remove}？[y/N] ').lower() != 'y':
            raise RuntimeError('已取消')
        password = os.environ.get('GPG_PASSPHRASE') or getpass.getpass('GPG passphrase: ')
        resume(create_publication(root, suite, operation, remote, password), remote)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f'✗ {error}\n发布未确认成功；可重试原命令或使用 --resume，冲突时使用 --sync。', file=sys.stderr)
        sys.exit(1)
