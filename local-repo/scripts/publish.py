"""Push immutable .deb files to the cloud-apt worker.

The local-repo/ only stores the GPG signing key and a packages.json manifest;
no reprepro, no db/, no pool/, no incoming/. The server keeps every deb
content-addressed under pool/ and switches suite publications atomically.
"""
import argparse
import getpass
import gzip
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid

from repo_state import atomic_json, gpg, repo_lock, safe_relative, sha256, signing_home


# Force line-buffered stdout so the per-chunk progress updates land in real
# time even when push.sh is invoked via a pipe, tee, CI capture, or anything
# that hides the tty. Without this, Python falls back to block-buffered
# mode on a non-tty stdout and the carriage-return lines accumulate hidden
# until the final flush.
try:
    sys.stdout.reconfigure(line_buffering=True)
except (AttributeError, ValueError, OSError):
    pass


def _format_size(n):
    if n >= 1024 * 1024:
        return f'{n / 1024 / 1024:.1f} MB'
    if n >= 1024:
        return f'{n / 1024:.0f} KB'
    return f'{n} B'


def _format_speed(bps):
    if bps >= 1024 * 1024:
        return f'{bps / 1024 / 1024:.1f} MB/s'
    if bps >= 1024:
        return f'{bps / 1024:.0f} KB/s'
    return f'{bps:.0f} B/s'


def _progress_line(sent, total):
    pct = sent / total if total else 1
    bar_width = 30
    filled = min(bar_width, int(pct * bar_width))
    bar = '=' * max(0, filled - 1) + ('>' if filled < bar_width else '=')
    return f'  {_format_size(sent)} / {_format_size(total)} [{bar.ljust(bar_width)}] {pct * 100:3.0f}%'


class Remote:
    def __init__(self, url, token):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('WORKER_URL must be an HTTPS URL')
        self.url, self.token = url.rstrip('/'), token

    def request(self, method, path, data=None, headers=None):
        with tempfile.TemporaryDirectory(prefix='cloud-apt-remote-') as directory:
            body_path, header_path, data_path = (os.path.join(directory, name)
                                                  for name in ('body', 'headers', 'data'))
            cmd = ['curl', '-sS', '--max-time', '120', '-X', method,
                   '-D', header_path, '-o', body_path, self.url + path]
            for key, value in (headers or {}).items():
                cmd += ['-H', f'{key}: {value}']
            cmd += ['-H', f'Authorization: Bearer {self.token}']
            if data is not None:
                with open(data_path, 'wb') as sink:
                    if hasattr(data, 'read'):
                        shutil.copyfileobj(data, sink)
                    else:
                        sink.write(data)
                cmd += ['--data-binary', f'@{data_path}']
            subprocess.run(cmd, check=True)
        with open(header_path) as sink:
            lines = sink.read().splitlines()
        status_line = lines[0] if lines else ''
        try:
            status = int(status_line.split()[1])
        except (IndexError, ValueError):
            raise RuntimeError(f'{method} {path}: malformed response status: {status_line!r}') from None
        headers_map = {}
        for line in lines[1:]:
            if ':' in line:
                name, _, value = line.partition(':')
                headers_map[name.strip().lower()] = value.strip()
        with open(body_path, 'rb') as sink:
            body = sink.read()
        if status >= 400:
            detail = body[:4096].decode(errors='replace')
            raise RuntimeError(f'{method} {path}: HTTP {status}: {detail}') from None
        return body, headers_map

    def current(self, suite):
        body, _ = self.request('GET', f'/api/publish/{suite}')
        data = json.loads(body)
        if 'packages' not in data:
            data['packages'] = []
        return data

    def upload(self, snapshot, record, on_progress=None):
        path = snapshot / record['local']
        if path.stat().st_size != record['size'] or sha256(path) != record['sha256']:
            raise RuntimeError(f'pending publication snapshot modified: {path}')
        size = record['size']
        with tempfile.TemporaryDirectory(prefix='cloud-apt-remote-') as directory:
            body_path, header_path = (os.path.join(directory, name)
                                      for name in ('body', 'headers'))
            cmd = ['curl', '-sS', '--max-time', '600', '-X', 'PUT',
                   '-D', header_path, '-o', body_path,
                   '-H', f'Content-Type: {record["content_type"]}',
                   '-H', f'Content-Length: {size}',
                   '-H', f'X-Content-SHA256: {record["sha256"]}',
                   '-H', f'Authorization: Bearer {self.token}',
                   '--data-binary', '@-',
                   self.url + '/api/upload/' + urllib.parse.quote(record['key'], safe='/')]
            start = time.monotonic()
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            chunk_size = 64 * 1024
            sent = 0
            last_update = start
            write_error = None
            try:
                with path.open('rb') as body:
                    while True:
                        chunk = body.read(chunk_size)
                        if not chunk:
                            break
                        try:
                            proc.stdin.write(chunk)
                        except (BrokenPipeError, ValueError, OSError) as error:
                            write_error = error
                            break
                        sent += len(chunk)
                        # Throttle to ~10 updates/sec, but always emit on a >0.5%
                        # jump so small files still show movement.
                        now = time.monotonic()
                        if on_progress and (now - last_update >= 0.1
                                            or sent == size
                                            or sent * 200 // max(size, 1) != (sent - len(chunk)) * 200 // max(size, 1)):
                            speed = sent / (now - start) if now > start else 0
                            on_progress(sent, size, speed)
                            last_update = now
            finally:
                if proc.stdin and not proc.stdin.closed:
                    try:
                        proc.stdin.close()
                    except (BrokenPipeError, ValueError, OSError):
                        pass
            try:
                returncode = proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                raise RuntimeError(f'upload {record["key"]} timed out after 30s')
            stderr_data = proc.stderr.read() if proc.stderr else b''
            elapsed = time.monotonic() - start
            if on_progress:
                speed = sent / elapsed if elapsed > 0 else 0
                on_progress(sent, size, speed, done=True)
            if write_error or returncode != 0:
                detail = stderr_data.decode(errors='replace')[:500]
                cause = f' ({write_error})' if write_error else ''
                raise RuntimeError(f'upload {record["key"]} failed (curl exit {returncode}){cause}: {detail}')
            with open(header_path) as sink:
                lines = sink.read().splitlines()
            try:
                status = int(lines[0].split()[1])
            except (IndexError, ValueError):
                raise RuntimeError(f'upload {record["key"]}: malformed response status: {lines[0]!r}') from None
            if status >= 400:
                with open(body_path, 'rb') as sink:
                    detail = sink.read()[:4096].decode(errors='replace')
                raise RuntimeError(f'upload {record["key"]}: HTTP {status}: {detail}')
            headers_map = {}
            for line in lines[1:]:
                if ':' in line:
                    name, _, value = line.partition(':')
                    headers_map[name.strip().lower()] = value.strip()
            if headers_map.get('x-content-sha256') != record['sha256']:
                raise RuntimeError('server did not confirm SHA256; deploy the new Worker first')

    def commit(self, suite, release, previous, files, packages):
        data = {
            'release': release,
            'previous': previous,
            'files': [{'key': f['key'], 'size': f['size'], 'sha256': f['sha256']} for f in files],
            'packages': packages,
        }
        self.request('POST', '/api/publish/' + suite,
                     json.dumps(data).encode(),
                     {'Content-Type': 'application/json'})


CODENAME_RE = re.compile(r'^[a-z0-9][a-z0-9.+~-]{0,63}$')
ARCH_RE = re.compile(r'^[a-z0-9][a-z0-9.+-]{0,31}$')


def release_entries(text):
    """Parse Release file's SHA256 index; kept for tests."""
    entries, section = [], ''
    for line in text.splitlines():
        if line.startswith(' '):
            if section == 'SHA256':
                digest, size, name = line.split()
                if not safe_relative(name) or not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
                    raise RuntimeError('Release contains unsafe path or wrong hash')
                entries.append((name, digest.lower(), int(size)))
        elif ':' in line:
            section = line.split(':', 1)[0]
    if not entries:
        raise RuntimeError('Release missing SHA256 index')
    return entries


def read_config(root):
    """Parse conf/distributions; no reprepro required."""
    config_path = root / 'conf/distributions'
    if not config_path.is_file():
        raise RuntimeError('missing conf/distributions; rerun init.sh')
    text = config_path.read_text()
    fields = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if ':' not in line:
            continue
        key, _, value = line.partition(':')
        fields.setdefault(key.strip(), value.strip())
    suite = fields.get('Suite') or fields.get('Codename')
    if not suite:
        raise RuntimeError('conf/distributions missing Suite/Codename')
    architectures = fields.get('Architectures', '').split()
    if not architectures:
        raise RuntimeError('conf/distributions missing Architectures')
    for arch in architectures:
        if not ARCH_RE.fullmatch(arch):
            raise RuntimeError(f'invalid architecture in conf/distributions: {arch}')
    components = fields.get('Components', '').split()
    if not components:
        raise RuntimeError('conf/distributions missing Components')
    return {
        'origin': fields.get('Origin', 'cloud-apt'),
        'label': fields.get('Label', 'cloud-apt'),
        'description': fields.get('Description', ''),
        'suite': suite,
        'architectures': architectures,
        'components': components,
    }


def load_packages(root):
    path = root / 'packages.json'
    if not path.is_file():
        return []
    return json.loads(path.read_text())


def save_packages(root, packages):
    atomic_json(root / 'packages.json', packages)


def pool_filename(package):
    name = package['Package']
    if name.startswith('lib'):
        prefix = 'lib' + name[3]
    else:
        prefix = name[0]
    return f'pool/main/{prefix}/{name}/{name}_{package["Version"]}_{package["Architecture"]}.deb'


# Map internal lowercase keys -> Debian-style uppercase field headers.
_PKG_DEBIAN_FIELDS = (
    ('package', 'Package', False),
    ('version', 'Version', False),
    ('architecture', 'Architecture', False),
    ('maintainer', 'Maintainer', False),
    ('description', 'Description', True),
    ('depends', 'Depends', False),
    ('pre_depends', 'Pre-Depends', False),
    ('recommends', 'Recommends', False),
    ('suggests', 'Suggests', False),
    ('conflicts', 'Conflicts', False),
    ('replaces', 'Replaces', False),
    ('provides', 'Provides', False),
    ('section', 'Section', False),
    ('priority', 'Priority', False),
    ('filename', 'Filename', False),
    ('size', 'Size', False),
    ('sha256', 'SHA256', False),
    ('installed_size', 'Installed-Size', False),
    ('multi_arch', 'Multi-Arch', False),
    ('homepage', 'Homepage', False),
)


def generate_packages_txt(packages):
    out = io.StringIO()
    for pkg in sorted(packages, key=lambda p: (p['package'].lower(), p['architecture'])):
        for internal_key, debian_key, multiline in _PKG_DEBIAN_FIELDS:
            if internal_key not in pkg or pkg[internal_key] in (None, ''):
                continue
            value = str(pkg[internal_key])
            if multiline:
                lines = value.split('\n')
                out.write(f'{debian_key}: {lines[0]}\n')
                for continuation in lines[1:]:
                    out.write(f' {continuation}\n')
            else:
                out.write(f'{debian_key}: {value}\n')
        out.write('\n')
    return out.getvalue()


def generate_release(config, entries):
    lines = [
        f'Origin: {config["origin"]}',
        f'Label: {config["label"]}',
        f'Suite: {config["suite"]}',
        f'Codename: {config["suite"]}',
        f'Architectures: {" ".join(config["architectures"])}',
        f'Components: {" ".join(config["components"])}',
    ]
    if config['description']:
        lines.append(f'Description: {config["description"]}')
    lines += [
        f'Date: {time.strftime("%a, %d %b %Y %H:%M:%S UTC", time.gmtime())}',
        'Acquire-By-Hash: yes',
    ]
    if entries:
        lines.append('SHA256:')
        for name, digest, size in entries:
            lines.append(f' {digest} {size} {name}')
    return '\n'.join(lines) + '\n'


def parse_deb_control(deb_path):
    """Run dpkg-deb -f and parse control fields."""
    proc = subprocess.run(['dpkg-deb', '-f', str(deb_path)],
                          capture_output=True, check=True)
    fields = {}
    current_key, current_value = None, []
    for line in proc.stdout.decode().splitlines():
        if line.startswith(' '):
            if current_key:
                current_value.append(line[1:])
            continue
        if ':' in line:
            if current_key:
                fields[current_key] = '\n'.join(current_value).strip()
            key, _, value = line.partition(':')
            current_key = key.strip()
            current_value = [value.strip()]
    if current_key:
        fields[current_key] = '\n'.join(current_value).strip()
    for required in ('Package', 'Version', 'Architecture'):
        if required not in fields or not fields[required]:
            raise RuntimeError(f'{deb_path} missing required control field: {required}')
    return fields


def _sign_release(home, fingerprint, password, release_path):
    idx_dir = release_path.parent
    gpg(home, ['--armor', '--local-user', fingerprint,
          '--output', str(idx_dir / 'InRelease'),
          '--clearsign', str(release_path)], password)
    gpg(home, ['--armor', '--local-user', fingerprint,
          '--output', str(idx_dir / 'Release.gpg'),
          '--detach-sign', str(release_path)], password)
    gpg(home, ['--verify', str(idx_dir / 'InRelease')])
    gpg(home, ['--verify', str(idx_dir / 'Release.gpg'), str(release_path)])


def prepare_snapshot(root, suite, release_id, packages, config, pool_debs, home, fingerprint, password):
    """Stage snapshot files (deb copies + APT indexes + signatures); return (snapshot_dir, files)."""
    snapshot = root / '.publish' / release_id
    snapshot.mkdir(parents=True, exist_ok=True)

    files = []
    for filename, deb_path in pool_debs.items():
        if not filename.startswith('pool/') or not safe_relative(filename):
            raise RuntimeError(f'unsafe pool filename: {filename}')
        staged_path = snapshot / filename
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(deb_path, staged_path)
        files.append({
            'key': filename, 'local': filename,
            'sha256': sha256(staged_path), 'size': staged_path.stat().st_size,
            'content_type': 'application/octet-stream',
        })

    idx_root = snapshot / 'dists' / suite / '.snapshots' / release_id
    idx_root.mkdir(parents=True, exist_ok=True)

    by_arch = {}
    for pkg in packages:
        by_arch.setdefault(pkg['architecture'], []).append(pkg)

    release_entries_local = []
    for arch in sorted(by_arch):
        arch_pkgs = by_arch[arch]
        packages_txt = generate_packages_txt(arch_pkgs)
        arch_dir = idx_root / 'main' / f'binary-{arch}'
        arch_dir.mkdir(parents=True, exist_ok=True)
        packages_file = arch_dir / 'Packages'
        packages_file.write_text(packages_txt)

        gz_path = arch_dir / 'Packages.gz'
        with gz_path.open('wb') as sink:
            with gzip.GzipFile(fileobj=sink, mtime=0) as gz:
                gz.write(packages_txt.encode())

        gz_digest = sha256(gz_path)
        gz_size = gz_path.stat().st_size

        # by-hash copy for the gzip index (apt's preferred download form).
        gz_by_hash = (snapshot / 'dists' / suite / 'main' / f'binary-{arch}'
                      / 'by-hash' / 'SHA256' / gz_digest)
        gz_by_hash.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(gz_path, gz_by_hash)

        # Mirror the uncompressed Packages file by hash too so apt can fetch either form.
        plain_digest = sha256(packages_file)
        plain_by_hash = (snapshot / 'dists' / suite / 'main' / f'binary-{arch}'
                         / 'by-hash' / 'SHA256' / plain_digest)
        plain_by_hash.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(packages_file, plain_by_hash)

        for path, content_type in [(packages_file, 'text/plain'),
                                    (gz_path, 'application/gzip'),
                                    (gz_by_hash, 'application/gzip'),
                                    (plain_by_hash, 'text/plain')]:
            files.append({
                'key': str(path.relative_to(snapshot).as_posix()),
                'local': str(path.relative_to(snapshot).as_posix()),
                'sha256': sha256(path), 'size': path.stat().st_size,
                'content_type': content_type,
            })

        release_entries_local.append((f'main/binary-{arch}/Packages', plain_digest, packages_file.stat().st_size))
        release_entries_local.append((f'main/binary-{arch}/Packages.gz', gz_digest, gz_size))

    release_path = idx_root / 'Release'
    release_path.write_text(generate_release(config, release_entries_local))
    _sign_release(home, fingerprint, password, release_path)

    for name, content_type in [('Release', 'text/plain'),
                                ('InRelease', 'text/plain'),
                                ('Release.gpg', 'application/octet-stream')]:
        path = idx_root / name
        files.append({
            'key': str(path.relative_to(snapshot).as_posix()),
            'local': str(path.relative_to(snapshot).as_posix()),
            'sha256': sha256(path), 'size': path.stat().st_size,
            'content_type': content_type,
        })

    return snapshot, files


def _ensure_packages_payload(packages):
    """Sanity check: every package has the fields required to generate Packages."""
    out = []
    for pkg in packages:
        if not all(k in pkg for k in ('package', 'version', 'architecture', 'filename', 'sha256', 'size')):
            raise RuntimeError(f'package entry missing required field: {pkg}')
        if not pkg['filename'].startswith('pool/') or not safe_relative(pkg['filename']):
            raise RuntimeError(f'unsafe filename in packages: {pkg["filename"]}')
        out.append(pkg)
    return out


def create_publication(root, suite, operation, remote, password):
    server_state = remote.current(suite)
    server_packages = _ensure_packages_payload(server_state.get('packages', []))
    previous_etag = server_state.get('etag')

    config = read_config(root)
    if config['suite'] != suite:
        raise RuntimeError(f'conf/distributions Suite ({config["suite"]}) does not match target suite ({suite})')

    local_packages = _ensure_packages_payload(load_packages(root))
    # Always merge server packages: the catalog must not regress on packages that
    # other maintainers (or earlier sessions of this one) already published.
    server_keys = {(p['package'], p['architecture'], p['version']) for p in server_packages}
    desired = list(server_packages) + [p for p in local_packages
                                       if (p['package'], p['architecture'], p['version']) not in server_keys]
    pool_debs = {}

    if operation['mode'] == 'include':
        deb_path = Path(operation['deb']).resolve()
        if not deb_path.is_file():
            raise RuntimeError(f'deb not found: {deb_path}')
        fields = parse_deb_control(deb_path)
        if fields['Architecture'] not in config['architectures']:
            raise RuntimeError(f'deb architecture {fields["Architecture"]!r} not in conf/distributions Architectures')
        entry = {
            'package': fields['Package'],
            'version': fields['Version'],
            'architecture': fields['Architecture'],
            'filename': pool_filename(fields),
            'sha256': sha256(deb_path),
            'size': deb_path.stat().st_size,
            'maintainer': fields.get('Maintainer', ''),
            'description': fields.get('Description', ''),
            'depends': fields.get('Depends', ''),
            'pre_depends': fields.get('Pre-Depends', ''),
            'recommends': fields.get('Recommends', ''),
            'suggests': fields.get('Suggests', ''),
            'conflicts': fields.get('Conflicts', ''),
            'replaces': fields.get('Replaces', ''),
            'provides': fields.get('Provides', ''),
            'section': fields.get('Section', ''),
            'priority': fields.get('Priority', ''),
            'homepage': fields.get('Homepage', ''),
            'installed_size': fields.get('Installed-Size', ''),
            'multi_arch': fields.get('Multi-Arch', ''),
        }
        same_full = [p for p in desired if p['package'] == entry['package']
                    and p['architecture'] == entry['architecture']
                    and p['version'] == entry['version']]
        if same_full:
            existing = same_full[0]
            if existing['sha256'] != entry['sha256']:
                raise RuntimeError(f'{entry["package"]} {entry["architecture"]} version {entry["version"]} exists with a different checksum; immutable debs cannot be replaced')
            print(f'ok: {entry["package"]} {entry["architecture"]} version {entry["version"]} already current; nothing to publish')
            return None
        desired.append(entry)
        pool_debs[entry['filename']] = deb_path
    elif operation['mode'] == 'remove':
        target = operation['package']
        before = len(desired)
        desired = [p for p in desired if p['package'] != target]
        if len(desired) == before:
            raise RuntimeError(f'package not in local catalog: {target}')
    elif operation['mode'] == 'sync':
        save_packages(root, server_packages)
        print(f'ok: synced {len(server_packages)} packages from server')
        return None
    else:
        raise RuntimeError(f'unknown operation mode: {operation["mode"]}')

    with signing_home(root, password) as (home, fingerprint):
        release_id = uuid.uuid4().hex
        snapshot, files = prepare_snapshot(root, suite, release_id, desired, config,
                                            pool_debs, home, fingerprint, password)

    state = {
        'release': release_id, 'previous': previous_etag, 'suite': suite,
        'url': remote.url, 'operation': operation, 'files': files,
        'packages': desired, 'uploaded': [],
    }
    atomic_json(snapshot / 'state.json', state)
    atomic_json(root / '.publish' / 'pending.json', {'release': release_id})
    save_packages(root, desired)
    return snapshot


def resume(snapshot, remote):
    state = json.loads((snapshot / 'state.json').read_text())
    if state['url'] != remote.url:
        raise RuntimeError('pending publication snapshot belongs to another Worker; push refused')
    for record in state['files']:
        if record['key'] in state['uploaded']:
            continue
        print('upload and verify ' + record['key'], flush=True)
        def on_progress(sent, total, speed, done=False, key=record['key']):
            line = _progress_line(sent, total) + f' {_format_speed(speed)}'
            if done:
                print(f'  {key}: {line}')
            else:
                print(line, end='\r', flush=True)
        try:
            remote.upload(snapshot, record, on_progress)
        except RuntimeError:
            print()
            raise
        state['uploaded'].append(record['key'])
        atomic_json(snapshot / 'state.json', state)
    remote.commit(state['suite'], state['release'], state['previous'], state['files'], state['packages'])
    atomic_json(snapshot.parent / 'last-success.json',
                {'release': state['release'], 'suite': state['suite']})
    (snapshot.parent / 'pending.json').unlink(missing_ok=True)
    shutil.rmtree(snapshot)
    print(f"ok: published {state['suite']} ({state['release']})")


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
            parser.error('a .deb path, or --sync / --resume / --remove, is required')
        deb = Path(args.arguments[0]).resolve()
        suite = args.arguments[1] if len(args.arguments) > 1 else 'kali-rolling'
        operation = {'mode': 'include', 'deb': str(deb), 'sha256': sha256(deb)}
    if not CODENAME_RE.fullmatch(suite):
        raise ValueError('invalid suite')
    with repo_lock(root):
        pending = root / '.publish' / 'pending.json'
        if pending.exists() and not args.sync:
            snapshot = pending.parent / json.loads(pending.read_text())['release']
            old = json.loads((snapshot / 'state.json').read_text())
            if old['suite'] != suite or (not args.resume and old['operation'] != operation):
                raise RuntimeError('another pending publication exists; run --resume [suite] or --sync [suite] to fully resync')
            resume(snapshot, remote)
            return
        if args.resume:
            raise RuntimeError('no pending publication to resume')
        if args.remove and os.environ.get('YES') != '1' and input(f'remove {args.remove}? [y/N] ').lower() != 'y':
            raise RuntimeError('cancelled')
        password = os.environ.get('GPG_PASSPHRASE') or getpass.getpass('GPG passphrase: ')
        snapshot = create_publication(root, suite, operation, remote, password)
        if snapshot is None:
            return
        resume(snapshot, remote)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f'x {error}\npublication not confirmed; retry or use --resume, --sync on conflict.', file=sys.stderr)
        sys.exit(1)