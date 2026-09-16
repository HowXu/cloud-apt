"""Shared state and crypto helpers (Python 3.10+, GnuPG, Linux)."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
        temporary = stream.name
    os.replace(temporary, path)


@contextlib.contextmanager
def repo_lock(root):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    # Never move/delete this inode during import or after unlock.
    with (root / '.repository.lock').open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('repository is busy (publishing, exporting, or migrating); retry later') from None
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def key_fingerprint(root):
    values = dict(line.split('=', 1) for line in (Path(root) / 'keys/keyid.txt').read_text().splitlines() if '=' in line)
    fingerprint = values.get('FPR', '').upper()
    if not re.fullmatch(r'[A-F0-9]{40,64}', fingerprint):
        raise RuntimeError('keys/keyid.txt missing a valid full fingerprint')
    return fingerprint


def gpg(home, args, password=None, data=None):
    command = ['gpg', '--homedir', str(home), '--batch', '--yes', '--no-tty']
    if password is not None:
        command += ['--pinentry-mode', 'loopback', '--passphrase-fd', '0']
        data = (password + '\n').encode()
    result = subprocess.run(command + list(map(str, args)), input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('GPG operation failed: ' + result.stderr.decode(errors='replace'))
    return result.stdout


@contextlib.contextmanager
def signing_home(root, password):
    """Restore and test the expected secret key in an isolated disposable keyring."""
    fingerprint = key_fingerprint(root)
    with tempfile.TemporaryDirectory(prefix='cloud-apt-gpg-') as directory:
        home = Path(directory)
        home.chmod(0o700)
        try:
            gpg(home, ['--import', Path(root) / 'keys/public.key'])
            public = gpg(home, ['--with-colons', '--list-keys']).decode()
            fingerprints = [line.split(':')[9] for line in public.splitlines() if line.startswith('fpr:')]
            if not fingerprints or fingerprints[0] != fingerprint:
                raise RuntimeError('public key fingerprint does not match keyid.txt')
            secret = gpg(home, ['--decrypt', Path(root) / 'keys/private.key.gpg'], password)
            gpg(home, ['--import'], data=secret)
            del secret
            keys = gpg(home, ['--with-colons', '--list-secret-keys', fingerprint]).decode()
            if not any(line.startswith('sec:') for line in keys.splitlines()):
                raise RuntimeError('private signing key missing from backup')
            probe = home / 'probe'
            probe.write_bytes(b'cloud-apt signing self-test\n')
            gpg(home, ['--local-user', fingerprint, '--detach-sign', probe], password)
            gpg(home, ['--verify', str(probe) + '.sig', probe])
            yield home, fingerprint
        finally:
            subprocess.run(['gpgconf', '--homedir', str(home), '--kill', 'gpg-agent'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def safe_relative(name):
    return bool(name) and not name.startswith('/') and not any(
        part in ('', '.', '..') for part in name.split('/')) and not any(c in name for c in '\\\x00\r\n')
