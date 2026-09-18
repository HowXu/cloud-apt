"""Real GPG + dpkg-deb tests using an isolated repository and simulated upload failures."""
import contextlib
import io
import http.server
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from repo_state import atomic_json, gpg, repo_lock, sha256, signing_home
from publish import create_publication, resume, release_entries
from migrate import export_repository, import_repository, replace_state

PASSWORD = 'test-passphrase-only-123'
SUITE = 'kali-rolling'


class FakeRemote:
    url = 'https://repo.test'

    def __init__(self):
        self.files, self.calls, self.active = {}, [], None
        self.active_packages = []
        self.fail_key = None
        self.lose_commit_response = False

    def current(self, suite):
        return {'etag': self.active, 'release': self.active, 'packages': self.active_packages}

    def upload(self, snapshot, record, on_progress=None):
        self.calls.append(record['key'])
        if self.fail_key and self.fail_key in record['key']:
            self.fail_key = None
            raise OSError('simulated disconnect')
        path = snapshot / record['local']
        if sha256(path) != record['sha256']:
            raise RuntimeError('corrupt snapshot')
        self.files[record['key']] = path.read_bytes()
        if on_progress:
            on_progress(record['size'], record['size'], 0, done=True)

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
        if self.lose_commit_response:
            self.lose_commit_response = False
            raise OSError('commit succeeded, response lost')


class RepositoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Fail rather than skip when the CI integration dependencies are missing.
        for command in ('gpg', 'gpgconf', 'dpkg-deb'):
            if not shutil.which(command):
                raise RuntimeError(f'Missing required integration-test tool: {command}')
        cls.fixture = tempfile.TemporaryDirectory(prefix='cloud-apt-fixture-')
        cls.base = Path(cls.fixture.name)
        cls.home = cls.base / 'gpg'
        cls.home.mkdir(mode=0o700)
        gpg(cls.home, ['--quick-generate-key', 'Test <review@example.invalid>', 'ed25519', 'sign', '0'], PASSWORD)
        listing = gpg(cls.home, ['--with-colons', '--list-secret-keys']).decode()
        cls.fingerprint = next(line.split(':')[9] for line in listing.splitlines() if line.startswith('fpr:'))
        cls.keys = cls.base / 'keys'
        cls.keys.mkdir(mode=0o700)
        (cls.keys / 'public.key').write_bytes(gpg(cls.home, ['--armor', '--export', cls.fingerprint]))
        secret = cls.base / 'secret.asc'
        secret.write_bytes(gpg(cls.home, ['--armor', '--export-secret-keys', cls.fingerprint], PASSWORD))
        secret.chmod(0o600)
        gpg(cls.home, ['--symmetric', '--cipher-algo', 'AES256', '--output', cls.keys / 'private.key.gpg', secret], PASSWORD)
        secret.unlink()
        (cls.keys / 'keyid.txt').write_text(f'EMAIL=review@example.invalid\nFPR={cls.fingerprint}\n')

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['gpgconf', '--homedir', str(cls.home), '--kill', 'gpg-agent'], check=False)
        cls.fixture.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cloud-apt-test-')
        self.addCleanup(self.tmp.cleanup)
        # self.repo is the import target (mirrors a cloned cloud-apt/ tree);
        # self.root is the local-repo/ inside it, where state and scripts live.
        self.repo = Path(self.tmp.name) / 'repo'
        self.root = self.repo / 'local-repo'
        for name in ('conf', 'scripts', 'dockerfiles'):
            (self.root / name).mkdir(parents=True)
        shutil.copytree(self.keys, self.root / 'keys')
        (self.root / 'scripts/sentinel').write_text('installed tools')
        (self.root / 'conf/distributions.template').write_text('installed template')
        (self.root / 'conf/distributions').write_text(
            f'Origin: cloud-apt\nLabel: Test\nCodename: {SUITE}\nSuite: {SUITE}\n'
            f'Architectures: amd64 arm64\nComponents: main\n')
        self.remote = FakeRemote()

    def deb(self, version='1.0'):
        stage = Path(self.tmp.name) / ('package-' + version)
        (stage / 'DEBIAN').mkdir(parents=True)
        (stage / 'DEBIAN/control').write_text(
            f'Package: cloud-apt-test\nVersion: {version}\nArchitecture: amd64\nSection: utils\nPriority: optional\nMaintainer: Test <test@example.invalid>\nDescription: integration test\n')
        (stage / 'usr/share/cloud-apt-test').mkdir(parents=True)
        (stage / 'usr/share/cloud-apt-test/version').write_text(version)
        output = Path(self.tmp.name) / f'cloud-apt-test_{version}_amd64.deb'
        subprocess.run(['dpkg-deb', '--build', '--root-owner-group', str(stage), str(output)], check=True, stdout=subprocess.DEVNULL)
        return output

    def prepare(self, version='1.0', mode='include', deb=None):
        operation = {'mode': mode}
        if mode == 'include':
            operation['deb'] = str(deb or self.deb(version))
        elif mode == 'remove':
            operation['package'] = 'cloud-apt-test'
        with repo_lock(self.root):
            return create_publication(self.root, SUITE, operation, self.remote, PASSWORD)

    def test_upload_disconnect_resumes_without_reupload(self):
        snapshot = self.prepare()
        self.remote.fail_key = 'pool/'
        with self.assertRaises(OSError):
            resume(snapshot, self.remote)
        self.assertIsNone(self.remote.active)
        self.assertTrue((self.root / '.publish/pending.json').exists())
        for path in self.root.glob('pool/**/*.deb'):
            path.unlink()
        resume(snapshot, self.remote)
        self.assertIsNotNone(self.remote.active)
        self.assertTrue(any('/.snapshots/' not in key and key.startswith('pool/') for key in self.remote.calls))
        self.assertFalse((self.root / '.publish/pending.json').exists())

    def test_lost_commit_response_retries_exact_snapshot_without_reupload(self):
        snapshot = self.prepare()
        self.remote.lose_commit_response = True
        with self.assertRaises(OSError):
            resume(snapshot, self.remote)
        calls = list(self.remote.calls)
        resume(snapshot, self.remote)
        self.assertEqual(self.remote.calls, calls)

    def test_signed_by_hash_indexes_and_old_files_survive_upgrade_and_remove(self):
        snapshot = self.prepare()
        state = json.loads((snapshot / 'state.json').read_text())
        release_path = snapshot / f'dists/{SUITE}/.snapshots/{state["release"]}/Release'
        release = release_path.read_text()
        self.assertIn('Acquire-By-Hash: yes', release)
        with signing_home(self.root, PASSWORD) as (home, _):
            signed_text = gpg(home, ['--decrypt', release_path.parent / 'InRelease']).decode()
            self.assertEqual(signed_text, release)
        for name, digest, _ in release_entries(release):
            key = f'dists/{SUITE}/{Path(name).parent.as_posix()}/by-hash/SHA256/{digest}'
            self.assertTrue(any(f['key'] == key for f in state['files']))
        resume(snapshot, self.remote)
        old_files = dict(self.remote.files)
        upgraded = self.prepare('2.0')
        upgrade_release = json.loads((upgraded / 'state.json').read_text())['release']
        self.remote.fail_key = '/.snapshots/'
        old_active = self.remote.active
        with self.assertRaises(OSError):
            resume(upgraded, self.remote)
        self.assertEqual(self.remote.active, old_active)
        resume(upgraded, self.remote)
        for key, value in old_files.items():
            self.assertEqual(self.remote.files[key], value)
        # Both versions now advertised; only 2.0 needed a pool upload (1.0 was retained).
        latest_pkg_key = next(k for k in self.remote.files
                              if k.endswith('main/binary-amd64/Packages')
                              and upgrade_release in k)
        packages_txt = self.remote.files[latest_pkg_key]
        self.assertIn(b'Version: 1.0', packages_txt)
        self.assertIn(b'Version: 2.0', packages_txt)
        self.assertEqual(sum(k.startswith('pool/') and '1.0' in k for k in self.remote.calls), 1)
        self.assertEqual(sum(k.startswith('pool/') and '2.0' in k for k in self.remote.calls), 1)
        removed = self.prepare(mode='remove')
        self.assertFalse(any(f['key'].startswith('pool/') for f in json.loads((removed / 'state.json').read_text())['files']))
        resume(removed, self.remote)
        self.assertTrue(any(key.startswith('pool/') for key in self.remote.files))

    def test_lock_blocks_overlapping_publish_or_migration(self):
        with repo_lock(self.root):
            with self.assertRaises(RuntimeError):
                with repo_lock(self.root):
                    pass

    def test_auto_sync_keeps_server_packages_when_local_catalog_is_stale(self):
        """If another maintainer published first, a stale local packages.json
        must not drop their package from the index."""
        deb_1 = self.deb('1.0')
        resume(self.prepare('1.0', deb=deb_1), self.remote)
        # Simulate a second maintainer whose local packages.json only knows 1.0.
        (self.root / 'packages.json').write_text(json.dumps([
            {'package': 'cloud-apt-test', 'version': '1.0', 'architecture': 'amd64',
             'filename': 'pool/main/c/cloud-apt-test/cloud-apt-test_1.0_amd64.deb',
             'sha256': sha256(deb_1), 'size': deb_1.stat().st_size},
        ]))
        upgrade = self.prepare('2.0')
        upgrade_release = json.loads((upgrade / 'state.json').read_text())['release']
        resume(upgrade, self.remote)
        packages_key = next(k for k in self.remote.files
                            if k.endswith('main/binary-amd64/Packages') and upgrade_release in k)
        packages_txt = self.remote.files[packages_key]
        self.assertIn(b'Version: 1.0', packages_txt)
        self.assertIn(b'Version: 2.0', packages_txt)
        # The 1.0 deb was already on the server, so no second pool upload for it.
        self.assertEqual(sum('1.0' in k and k.startswith('pool/') for k in self.remote.calls), 1)

    def test_pushing_same_deb_twice_is_idempotent(self):
        """Re-publishing the same sha256 must not re-upload nor break server state."""
        deb_path = self.deb('1.0')
        resume(self.prepare(deb=deb_path), self.remote)
        # Second include of the same deb must no-op and not commit anything.
        before_files = dict(self.remote.files)
        before_calls = list(self.remote.calls)
        result = create_publication(self.root, SUITE, {'mode': 'include', 'deb': str(deb_path)},
                                    self.remote, PASSWORD)
        self.assertIsNone(result)
        self.assertEqual(self.remote.files, before_files)
        self.assertEqual(self.remote.calls, before_calls)

    def test_archive_inside_target_keeps_tools_and_restores_signing_then_publish(self):
        resume(self.prepare(), self.remote)
        archive = self.root / 'backup.tar.gz'
        export_repository(self.root, archive)
        (self.root / 'keys/public.key').write_text('broken key')
        (self.root / '.publish/pending.json').write_text('stale upload')
        backup = import_repository(archive, self.repo, PASSWORD)
        self.assertTrue(archive.exists())
        self.assertEqual((self.root / 'scripts/sentinel').read_text(), 'installed tools')
        self.assertEqual((self.root / 'conf/distributions.template').read_text(), 'installed template')
        self.assertFalse((self.root / '.publish').exists())
        self.assertTrue((backup / '.publish/pending.json').exists())
        resume(self.prepare('2.0'), self.remote)

    def test_wrong_password_does_not_change_existing_state(self):
        archive = self.root / 'backup.tar.gz'
        export_repository(self.root, archive)
        (self.root / 'conf/sentinel').write_text('keep')
        with self.assertRaises(RuntimeError):
            import_repository(archive, self.repo, 'wrong-password')
        self.assertEqual((self.root / 'conf/sentinel').read_text(), 'keep')

    def test_restore_without_dists_reexports_successfully(self):
        resume(self.prepare(), self.remote)
        archive = self.root / 'backup.tar.gz'
        export_repository(self.root, archive, include_dists=False)
        imported = Path(self.tmp.name) / 'new-machine'
        import_repository(archive, imported, PASSWORD)
        self.assertEqual(list((imported / 'local-repo' / 'dists').iterdir()), [])
        # After import, packages.json reflects whatever the archive carried.
        packages_after = json.loads((imported / 'local-repo' / 'packages.json').read_text())
        self.assertEqual(len(packages_after), 1)
        # --sync pulls the current server state and writes packages.json locally.
        with repo_lock(imported / 'local-repo'):
            result = create_publication(imported / 'local-repo', SUITE, {'mode': 'sync'}, self.remote, PASSWORD)
            self.assertIsNone(result)
        # Now include a new deb so we have a real local repo ready to publish again.
        with repo_lock(imported / 'local-repo'):
            snapshot = create_publication(imported / 'local-repo', SUITE,
                                          {'mode': 'include', 'deb': str(self.deb('2.0'))},
                                          self.remote, PASSWORD)
        resume(snapshot, self.remote)

    def test_import_rejects_links_and_corruption_before_changing_state(self):
        archive = self.root / 'bad.tar.gz'
        with tarfile.open(archive, 'w:gz') as output:
            header = tarfile.TarInfo('keys')
            header.type, header.linkname = tarfile.SYMTYPE, '/tmp'
            output.addfile(header)
        before = (self.root / 'keys/public.key').read_bytes()
        with self.assertRaises(RuntimeError):
            import_repository(archive, self.repo, PASSWORD)
        self.assertEqual((self.root / 'keys/public.key').read_bytes(), before)
        export_repository(self.root, archive)
        rewritten = self.root / 'corrupt.tar.gz'
        with tarfile.open(archive, 'r:gz') as source, tarfile.open(rewritten, 'w:gz') as output:
            for member in source.getmembers():
                data = source.extractfile(member).read() if member.isfile() else None
                if member.name == 'conf/distributions':
                    data = b'corrupted\n'
                    member.size = len(data)
                output.addfile(member, io.BytesIO(data) if data is not None else None)
        with self.assertRaises(RuntimeError):
            import_repository(rewritten, self.repo, PASSWORD)
        self.assertEqual((self.root / 'keys/public.key').read_bytes(), before)

    def test_state_replacement_rolls_back_after_partial_failure(self):
        stage = Path(self.tmp.name) / 'stage'
        stage.mkdir()
        for name in ('keys', 'conf', 'dists'):
            (stage / name).mkdir()
            (stage / name / 'new').write_text('new')
        before = (self.root / 'keys/public.key').read_bytes()
        def failing_replace(source, destination):
            if Path(source) == stage / 'dists':
                raise OSError('simulated disk failure')
            os.replace(source, destination)
        with self.assertRaises(OSError):
            replace_state(self.repo, stage, failing_replace)
        self.assertEqual((self.root / 'keys/public.key').read_bytes(), before)
        self.assertFalse((self.root / 'conf/new').exists())
        self.assertTrue((self.root / 'scripts/sentinel').exists())

    def test_real_apt_verifies_signatures_uses_by_hash_and_downloads_deb(self):
        resume(self.prepare(), self.remote)
        remote, requests = self.remote, []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                key = self.path.lstrip('/')
                requests.append(key)
                if key.startswith(f'dists/{SUITE}/') and '/by-hash/' not in key:
                    key = key.replace(f'dists/{SUITE}/', f'dists/{SUITE}/.snapshots/{remote.active}/', 1)
                data = remote.files.get(key)
                if data is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        apt = Path(self.tmp.name) / 'apt'
        for name in ('state/lists/partial', 'cache/archives/partial', 'downloads'):
            (apt / name).mkdir(parents=True)
        key = apt / 'public.asc'
        key.write_bytes((self.root / 'keys/public.key').read_bytes())
        sources = apt / 'sources.list'
        sources.write_text(f'deb [arch=amd64 signed-by={key}] http://127.0.0.1:{server.server_port} {SUITE} main\n')
        command = ['apt-get', '-o', f'Dir::State={apt / "state"}', '-o', f'Dir::Cache={apt / "cache"}',
                   '-o', f'Dir::Etc::sourcelist={sources}', '-o', 'Dir::Etc::sourceparts=-',
                   '-o', 'APT::Architecture=amd64', '-o', 'Debug::NoLocking=1',
                   '-o', 'APT::Get::List-Cleanup=0', '-o', 'APT::Sandbox::User=' + os.environ.get('USER', 'root')]
        update = subprocess.run(command + ['update'], capture_output=True, text=True)
        self.assertEqual(update.returncode, 0, update.stdout + update.stderr)
        self.assertTrue(any('/by-hash/SHA256/' in key for key in requests), requests)
        download = subprocess.run(command + ['download', 'cloud-apt-test'], cwd=apt / 'downloads', capture_output=True, text=True)
        self.assertEqual(download.returncode, 0, download.stdout + download.stderr)
        downloaded = next((apt / 'downloads').glob('*.deb'))
        # Compare to the original .deb supplied to the publisher; pool/ no longer
        # holds a local copy because the worker owns immutable pool storage.
        self.assertEqual(sha256(downloaded), sha256(Path(self.tmp.name) / 'cloud-apt-test_1.0_amd64.deb'))


if __name__ == '__main__':
    unittest.main()
