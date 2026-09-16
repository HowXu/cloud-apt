/// <reference types="@cloudflare/vitest-pool-workers" />
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';
import { digest, releaseKey } from '../src/releases';

const bindings = () => ({ ...env, ADMIN_PUSH_TOKEN: 'test-token' }) as Bindings;
const auth = { Authorization: 'Bearer test-token' };
const suite = 'kali-rolling';
type Record = { key: string; size: number; sha256: string };

async function upload(key: string, body: string | ArrayBuffer) {
    const response = await app.request(`https://apt.test/api/upload/${key}`, {
        method: 'PUT', body, headers: { ...auth, 'Content-Type': 'application/octet-stream' },
    }, bindings());
    expect(response.status).toBe(200);
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    expect(response.headers.get('X-Content-SHA256')).toBe(await digest(bytes));
    return { key, size: bytes.byteLength, sha256: await digest(bytes) };
}

async function stage(id: string, packageName = 'foo') {
    const prefix = `dists/${suite}/.snapshots/${id}/`;
    const files: Record[] = [];
    for (const name of ['Release', 'Release.gpg', 'InRelease']) files.push(await upload(prefix + name, id + name));
    const text = `Package: ${packageName}\nVersion: 1\nArchitecture: amd64\nFilename: pool/${packageName}.deb\nSize: 3\n\n`;
    const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    files.push(await upload(prefix + 'main/binary-amd64/Packages.gz', gz));
    files.push(await upload(`dists/${suite}/main/binary-amd64/by-hash/SHA256/${await digest(gz)}`, gz));
    files.push(await upload(`pool/${packageName}.deb`, 'deb'));
    return files;
}

async function commit(release: string, files: Record[], previous: string | null = null) {
    return app.request(`https://apt.test/api/publish/${suite}`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ release, previous, files }),
    }, bindings());
}

async function current() {
    const res = await app.request(`https://apt.test/api/publish/${suite}`, { headers: auth }, bindings());
    return res.json() as Promise<{ release: string | null; etag: string | null }>;
}

describe('publication with real R2 storage', () => {
    it('requires authentication and validates the manifest', async () => {
        expect((await app.request(`https://apt.test/api/publish/${suite}`, {}, bindings())).status).toBe(401);
        expect((await commit('../bad', [])).status).toBe(400);
    });

    it('does not expose incomplete staging; commits atomically and retries idempotently', async () => {
        const id = 'a'.repeat(32);
        const files = await stage(id);
        expect((await app.request(`https://apt.test/dists/${suite}/InRelease`, {}, bindings())).status).toBe(404);
        expect((await app.request(`https://apt.test/${files[0].key}`, {}, bindings())).status).toBe(404);
        const missing = { key: 'pool/missing.deb', size: 3, sha256: 'f'.repeat(64) };
        expect((await commit(id, [...files, missing])).status).toBe(409);
        expect((await current()).release).toBeNull();
        expect((await commit(id, files)).status).toBe(200);
        const etag = (await current()).etag;
        expect((await commit(id, files)).status).toBe(200);
        expect((await current()).etag).toBe(etag);
        const res = await app.request(`https://apt.test/dists/${suite}/InRelease`, {}, bindings());
        expect(await res.text()).toBe(id + 'InRelease');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const index = await app.request(`https://apt.test/api/index/${suite}/amd64`, {}, bindings());
        expect((await index.json() as any).packages[0].Package).toBe('foo');
    });

    it('retains old by-hash downloads while canonical indexes switch to a new snapshot', async () => {
        const oldFiles = await stage('a'.repeat(32));
        await commit('a'.repeat(32), oldFiles);
        const previous = (await current()).etag;
        const newFiles = await stage('b'.repeat(32), 'bar');
        const before = await app.request(`https://apt.test/dists/${suite}/InRelease`, {}, bindings());
        expect(await before.text()).toBe('a'.repeat(32) + 'InRelease');
        expect((await commit('b'.repeat(32), newFiles, previous)).status).toBe(200);
        const oldHash = oldFiles.find(f => f.key.includes('/by-hash/'))!;
        const old = await app.request(`https://apt.test/${oldHash.key}`, {}, bindings());
        expect(await digest(await old.arrayBuffer())).toBe(oldHash.sha256);
        expect(old.headers.get('Cache-Control')).toContain('immutable');
        const index = await app.request(`https://apt.test/api/index/${suite}/amd64`, {}, bindings());
        expect((await index.json() as any).packages[0].Package).toBe('bar');
    });

    it('allows exactly one concurrent commit and rejects stale rollback attempts', async () => {
        const [a, b] = await Promise.all([stage('a'.repeat(32), 'foo'), stage('b'.repeat(32), 'bar')]);
        const results = await Promise.all([commit('a'.repeat(32), a), commit('b'.repeat(32), b)]);
        expect(results.map(r => r.status).sort()).toEqual([200, 409]);
        expect(await bindings().APT_BUCKET!.head(releaseKey(suite))).not.toBeNull();
    });

    it('rejects corrupt receipts, writes over immutable content, and deletes of retained files', async () => {
        const files = await stage('a'.repeat(32));
        const wrong = files.map(f => ({ ...f, sha256: '0'.repeat(64) }));
        expect((await commit('a'.repeat(32), wrong)).status).toBeGreaterThanOrEqual(400);
        for (const key of [files[0].key, 'pool/foo.deb', files.find(f => f.key.includes('/by-hash/'))!.key]) {
            const update = await app.request(`https://apt.test/api/upload/${key}`, {
                method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: 'changed',
            }, bindings());
            expect(update.status).toBe(409);
            expect((await app.request(`https://apt.test/api/upload/${key}`, { method: 'DELETE', headers: auth }, bindings())).status).toBe(409);
        }
    });

    it('adopts identical legacy pool files and rejects incorrect client checksums', async () => {
        await bindings().APT_BUCKET!.put('pool/legacy.deb', 'deb');
        await upload('pool/legacy.deb', 'deb');
        expect((await bindings().APT_BUCKET!.head('pool/legacy.deb'))!.customMetadata!.sha256).toBeTruthy();
        const result = await app.request('https://apt.test/api/upload/pool/new.deb', {
            method: 'PUT', body: 'deb', headers: { ...auth, 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': 'bad' },
        }, bindings());
        expect(result.status).toBe(400);
        expect(await bindings().APT_BUCKET!.head('pool/new.deb')).toBeNull();
    });

    it('uses the same decoded package key for upload and download', async () => {
        await upload('pool/test_1.0%2Bdfsg_amd64.deb', 'deb');
        const result = await app.request('https://apt.test/pool/test_1.0+dfsg_amd64.deb', {}, bindings());
        expect(await result.text()).toBe('deb');
    });
});
