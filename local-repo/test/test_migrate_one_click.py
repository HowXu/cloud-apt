"""Regression tests for one-click migrate-import."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from repo_state import gpg, repo_lock, sha256, signing_home
from migrate import export_repository, import_repository, replace_state
from publish import create_publication, resume

PASSWORD = 'test-passphrase-only-456'
SUITE = 'kali-rolling'


class FakeRemote:
    url = 'https://repo.test'

    def __init__(self):
        self.files, self.calls, self.active = {}, [], None
        self.active_packages = []

    def current(self, suite):
        return {'etag': self.active, 'release': self.active, 'packages': self.active_packages}

    def upload(self, snapshot, record, on_progress=None):
        self.calls.append(record['key'])
        path = snapshot / record['local']
        if sha256(path) != record['sha256']:
            raise RuntimeError('corrupt snapshot')
        self.files[record['key']] = path.read_bytes()

    def commit(self, suite, release, previous, files, packages):
        if self.active == release:
            return
        if self.active != previous:
            raise RuntimeError('concurrent publication')
        for f in files:
            if f['key'] not in self.files:
                raise RuntimeError('missing remote file')
        self.active = release
        self.active_packages = packages


def _ensure_gpg_tools():
    for cmd in ('gpg', 'gpgconf', 'dpkg-deb'):
        if not shutil.which(cmd):
            raise RuntimeError(f'Missing required integration-test tool: {cmd}')


@contextlib.contextmanager
def _fixture():
    _ensure_gpg_tools()
    base = tempfile.TemporaryDirectory(prefix='cloud-apt-mig1click-')
    home = Path(base.name) / 'gpg'
    home.mkdir(mode=0o700)
    gpg(home, ['--quick-generate-key', 'Test <review@example.invalid>', 'ed25519', 'sign', '0'], PASSWORD)
    listing = gpg(home, ['--with-colons', '--list-secret-keys']).decode()
    fingerprint = next(line.split(':')[9] for line in listing.splitlines() if line.startswith('fpr:'))
    gpg(home, ['--quick-add-key', fingerprint, 'cv25519', 'encr', '0'], PASSWORD)
    keys = Path(base.name) / 'keys'
    keys.mkdir(mode=0o700)
    (keys / 'public.key').write_bytes(gpg(home, ['--armor', '--export', fingerprint]))
    secret = Path(base.name) / 'secret.asc'
    secret.write_bytes(gpg(home, ['--armor', '--export-secret-keys', fingerprint], PASSWORD))
    secret.chmod(0o600)
    gpg(home, ['--symmetric', '--cipher-algo', 'AES256', '--output', keys / 'private.key.gpg', secret], PASSWORD)
    secret.unlink()
    (keys / 'keyid.txt').write_text(f'EMAIL=review@example.invalid\nFPR={fingerprint}\n')
    try:
        yield base, keys, fingerprint
    finally:
        subprocess.run(['gpgconf', '--homedir', str(home), '--kill', 'gpg-agent'], check=False)
        base.cleanup()


def _init_repo(root, keys, fingerprint):
    for name in ('conf', 'dists', 'scripts', 'local-repo', 'local-repo/scripts'):
        (root / name).mkdir(parents=True, exist_ok=True)
    shutil.copytree(keys, root / 'keys')
    (root / 'local-repo/scripts/sentinel').write_text('installed tools')
    (root / 'conf/distributions.template').write_text('installed template')
    (root / 'conf/distributions').write_text(
        f'Origin: cloud-apt\nLabel: Test\nCodename: {SUITE}\nSuite: {SUITE}\n'
        f'Architectures: amd64 arm64\nComponents: main\n')


def _deb(stage_dir, version):
    (stage_dir / 'DEBIAN').mkdir(parents=True)
    (stage_dir / 'DEBIAN/control').write_text(
        f'Package: cloud-apt-onclick\nVersion: {version}\nArchitecture: amd64\n'
        f'Section: utils\nPriority: optional\nMaintainer: Test <test@example.invalid>\n'
        f'Description: one-click integration test\n')
    (stage_dir / 'usr/share/cloud-apt-onclick').mkdir(parents=True)
    (stage_dir / 'usr/share/cloud-apt-onclick/version').write_text(version)
    output = stage_dir.parent / f'cloud-apt-onclick_{version}_amd64.deb'
    subprocess.run(['dpkg-deb', '--build', '--root-owner-group', str(stage_dir), str(output)],
                   check=True, stdout=subprocess.DEVNULL)
    return output


def _populate_source(root, remote, fingerprint):
    """Set up source repo with one published package + a config.env."""
    (root / 'config.env').write_text(
        'WORKER_URL="https://repo.test"\nADMIN_PUSH_TOKEN="secret-token-abc"\n')
    stage = root.parent / 'pkg-stage'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    package = _deb(stage, '1.0')
    with repo_lock(root):
        snapshot = create_publication(root, SUITE, {'mode': 'include', 'deb': str(package)},
                                      remote, PASSWORD)
    resume(snapshot, remote)


class OneClickTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cloud-apt-onclick-test-')
        self.addCleanup(self.tmp.cleanup)
        self._ctx = _fixture()
        self.fixture_base, self.keys, self.fingerprint = self._ctx.__enter__()
        self.addCleanup(lambda: self._ctx.__exit__(None, None, None))

    def test_import_writes_config_env_under_local_repo(self):
        remote = FakeRemote()
        src = Path(self.tmp.name) / 'src'
        src.mkdir()
        _init_repo(src, self.keys, self.fingerprint)
        _populate_source(src, remote, self.fingerprint)
        archive = src / 'backup.tar.gz'
        export_repository(src, archive)

        dst = Path(self.tmp.name) / 'dst'
        dst.mkdir()
        (dst / 'local-repo').mkdir()
        # post_import_sync has been removed; import only restores state, the user
        # runs ./push.sh --sync next to align packages.json with the remote.
        import_repository(archive, dst, PASSWORD)

        config_env = dst / 'local-repo' / 'config.env'
        self.assertTrue(config_env.exists(), 'config.env must land in local-repo/')
        self.assertEqual(config_env.stat().st_mode & 0o777, 0o600)
        content = config_env.read_text()
        self.assertIn('WORKER_URL=', content)
        self.assertIn('ADMIN_PUSH_TOKEN=', content)
        self.assertIn('secret-token-abc', content)
        # State dirs land under local-repo/, matching the source layout.
        for name in ('keys', 'conf'):
            self.assertTrue((dst / 'local-repo' / name).is_dir(),
                            f'{name} missing under local-repo/')
        self.assertTrue((dst / 'local-repo' / 'packages.json').is_file())

    def test_import_with_dists_in_archive_preserves_them(self):
        remote = FakeRemote()
        src = Path(self.tmp.name) / 'src'
        src.mkdir()
        _init_repo(src, self.keys, self.fingerprint)
        _populate_source(src, remote, self.fingerprint)
        # Plant an extra marker in src/dists/ to assert archive contents round-trip.
        (src / 'dists/marker').write_text('kept')
        archive = src / 'backup.tar.gz'
        export_repository(src, archive)

        dst = Path(self.tmp.name) / 'dst'
        dst.mkdir()
        (dst / 'local-repo').mkdir()
        import_repository(archive, dst, PASSWORD)
        self.assertTrue((dst / 'local-repo' / 'dists' / 'marker').is_file())
        self.assertEqual((dst / 'local-repo' / 'dists' / 'marker').read_text(), 'kept')

    def test_import_without_dists_creates_empty_directory(self):
        remote = FakeRemote()
        src = Path(self.tmp.name) / 'src'
        src.mkdir()
        _init_repo(src, self.keys, self.fingerprint)
        _populate_source(src, remote, self.fingerprint)
        archive = src / 'backup.tar.gz'
        export_repository(src, archive, include_dists=False)

        dst = Path(self.tmp.name) / 'dst'
        dst.mkdir()
        (dst / 'local-repo').mkdir()
        import_repository(archive, dst, PASSWORD)
        self.assertTrue((dst / 'local-repo' / 'dists').is_dir())
        self.assertEqual(list((dst / 'local-repo' / 'dists').iterdir()), [])

    def test_replace_state_rolls_back_config_env_on_partial_failure(self):
        src = Path(self.tmp.name) / 'src'
        src.mkdir()
        _init_repo(src, self.keys, self.fingerprint)
        (src / 'local-repo/config.env').write_text('WORKER_URL="https://old.example"\nADMIN_PUSH_TOKEN="old-token"\n')
        original_content = (src / 'local-repo/config.env').read_text()
        original_mode = (src / 'local-repo/config.env').stat().st_mode & 0o777

        stage = Path(self.tmp.name) / 'stage'
        stage.mkdir()
        for name in ('keys', 'conf', 'dists'):
            (stage / name).mkdir()
            (stage / name / 'new').write_text('new')
        (stage / 'config.env').write_text('WORKER_URL="https://new.example"\nADMIN_PUSH_TOKEN="new-token"\n')

        def failing_replace(source, destination):
            if Path(source) == stage / 'dists':
                raise OSError('simulated disk failure')
            os.replace(source, destination)

        with self.assertRaises(OSError):
            replace_state(src, stage, failing_replace)
        # config.env must be rolled back to its pre-call contents
        self.assertTrue((src / 'local-repo/config.env').exists())
        self.assertEqual((src / 'local-repo/config.env').read_text(), original_content)
        self.assertEqual((src / 'local-repo/config.env').stat().st_mode & 0o777, original_mode)
        # scripts/sentinel (placed in local-repo/ by _init_repo) survives
        self.assertEqual((src / 'local-repo/scripts/sentinel').read_text(), 'installed tools')


if __name__ == '__main__':
    unittest.main()