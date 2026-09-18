import { describe, it, expect, vi } from 'vitest';
import { handleUpload, handleFinalize, handlePresign } from '../src/upload';

const mockR2 = () => ({
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
});

const env = () => ({
    APT_BUCKET: mockR2() as any,
    ADMIN_PUSH_TOKEN: 'secret',
});

describe('handleUpload', () => {
    it('401 without Bearer', async () => {
        const req = new Request('https://x/api/upload/dists/x/Release', {
            method: 'PUT', body: 'data',
        });
        const r = await handleUpload(req, env());
        expect(r.status).toBe(401);
    });

    it('PUT uploads to R2', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/dists/kali-rolling/Release', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' },
            body: 'release data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(200);
        expect((e.APT_BUCKET.put as any).mock.calls[0][0]).toBe('dists/kali-rolling/Release');
        const putArg = (e.APT_BUCKET.put as any).mock.calls[0][1];
        expect(putArg instanceof ArrayBuffer).toBe(true);
        expect(new TextDecoder().decode(putArg)).toBe('release data');
    });

    it('400 for unsafe path', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/../etc/passwd', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret' },
            body: 'data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(400);
    });

    it('400 for non-whitelisted path', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/random/path', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret' },
            body: 'data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(400);
    });

    it('DELETE removes from R2', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/dists/kali-rolling/main/binary-amd64/Packages', {
            method: 'DELETE',
            headers: { Authorization: 'Bearer secret' },
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(200);
        expect((e.APT_BUCKET.delete as any).mock.calls[0][0]).toBe('dists/kali-rolling/main/binary-amd64/Packages');
    });

    it('405 for non-PUT/DELETE methods', async () => {
        const req = new Request('https://x/api/upload/dists/x', {
            method: 'GET',
            headers: { Authorization: 'Bearer secret' },
        });
        const r = await handleUpload(req, env());
        expect(r.status).toBe(405);
    });

    it('400 for invalid Content-Type on pool/ (text/html)', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/pool/main/x/x.html', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/html' },
            body: '<script>alert(1)</script>',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(400);
    });

    it('400 for invalid Content-Type on dists/ (text/html)', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/dists/kali-rolling/x.html', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/html' },
            body: '<script>alert(1)</script>',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(400);
    });

    it('200 for valid Content-Type on pool/ (application/octet-stream)', async () => {
        const e = env();
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb', {
            method: 'PUT',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/octet-stream' },
            body: 'deb-data',
        });
        const r = await handleUpload(req, e);
        expect(r.status).toBe(200);
    });
});

const finalizeMockR2 = (overrides: Partial<{ put: any; head: any; delete: any }> = {}) => ({
    put: overrides.put ?? vi.fn(async () => ({})),
    head: overrides.head ?? vi.fn(async () => null),
    delete: overrides.delete ?? vi.fn(async () => ({})),
});

describe('handleFinalize', () => {
    const sha = 'a'.repeat(64);
    const envFor = (bucket: any) => ({
        APT_BUCKET: bucket, ADMIN_PUSH_TOKEN: 'secret',
    });

    it('401 without Bearer', async () => {
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/finalize', {
            method: 'POST', body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(finalizeMockR2()));
        expect(r.status).toBe(401);
    });

    it('400 for unsafe path', async () => {
        const req = new Request('https://x/api/upload/../etc/passwd/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(finalizeMockR2()));
        expect(r.status).toBe(400);
    });

    it('404 when R2 object is missing', async () => {
        const bucket = finalizeMockR2({ head: vi.fn(async () => null) });
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(bucket));
        expect(r.status).toBe(404);
    });

    it('400 when R2 size differs from claimed size', async () => {
        const bucket = finalizeMockR2({
            head: vi.fn(async () => ({
                size: 200,
                customMetadata: { sha256: sha },
                etag: 'e',
            } as any)),
        });
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(bucket));
        expect(r.status).toBe(400);
    });

    it('400 when R2 sha256 metadata differs', async () => {
        const bucket = finalizeMockR2({
            head: vi.fn(async () => ({
                size: 100, etag: 'e',
                customMetadata: { sha256: 'b'.repeat(64) },
            } as any)),
        });
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(bucket));
        expect(r.status).toBe(400);
    });

    it('409 when immutable and pre-existing object has a different hash (deletes new copy)', async () => {
        const headFn = vi.fn(async () => ({
            size: 100, etag: 'e', customMetadata: { sha256: sha },
        } as any))
            .mockResolvedValueOnce({ size: 100, etag: 'e', customMetadata: { sha256: sha } } as any)
            .mockResolvedValueOnce({ size: 100, etag: 'old', customMetadata: { sha256: 'c'.repeat(64) } } as any);
        const deleteFn = vi.fn(async () => ({}));
        const bucket = finalizeMockR2({ head: headFn, delete: deleteFn });
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(bucket));
        expect(r.status).toBe(409);
        expect(deleteFn).toHaveBeenCalledWith('pool/main/f/foo/foo_1.0_amd64.deb');
    });

    it('200 idempotent when immutable and existing object has the same hash', async () => {
        const bucket = finalizeMockR2({
            head: vi.fn(async () => ({
                size: 100, etag: 'e', customMetadata: { sha256: sha },
            } as any)),
        });
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(bucket));
        expect(r.status).toBe(200);
        expect(r.headers.get('X-Content-SHA256')).toBe(sha);
    });

    it('200 for non-immutable key', async () => {
        const bucket = finalizeMockR2({
            head: vi.fn(async () => ({
                size: 100, etag: 'e', customMetadata: { sha256: sha },
            } as any)),
        });
        const req = new Request('https://x/api/upload/dists/kali-rolling/Release/finalize', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 100, sha256: sha }),
        });
        const r = await handleFinalize(req, envFor(bucket));
        expect(r.status).toBe(200);
    });
});

const presignEnv = () => ({
    APT_BUCKET: mockR2() as any,
    ADMIN_PUSH_TOKEN: 'secret',
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_BUCKET_NAME: 'cloud-apt',
    R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
});

describe('handlePresign', () => {
    it('401 without Bearer', async () => {
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/presign', {
            method: 'POST', body: JSON.stringify({ size: 1, sha256: 'a'.repeat(64) }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(401);
    });

    it('400 for unsafe path', async () => {
        const req = new Request('https://x/api/upload/../etc/passwd/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 1, sha256: 'a'.repeat(64) }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(400);
    });

    it('400 for non-pool/dist path', async () => {
        const req = new Request('https://x/api/upload/random/x/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 1, sha256: 'a'.repeat(64) }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(400);
    });

    it('400 for malformed JSON', async () => {
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/presign', {
            method: 'POST', headers: { Authorization: 'Bearer secret' }, body: '{not json',
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(400);
    });

    it('400 for invalid sha256', async () => {
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 1, sha256: 'nope' }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(400);
    });

    it('413 for size above 5 GB', async () => {
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 5_368_709_122, sha256: 'a'.repeat(64) }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(413);
    });

    it('500 when R2_ACCOUNT_ID / R2_ACCESS_KEY_ID missing', async () => {
        const e = { ...presignEnv() } as any;
        delete e.R2_ACCOUNT_ID;
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret' },
            body: JSON.stringify({ size: 1, sha256: 'a'.repeat(64) }),
        });
        const r = await handlePresign(req, e);
        expect(r.status).toBe(500);
    });

    it('200 with presigned URL + headers + expires_in for pool/ deb', async () => {
        const req = new Request('https://x/api/upload/pool/main/f/foo/foo_1.0_amd64.deb/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                size: 1234, sha256: 'a'.repeat(64),
                content_type: 'application/octet-stream',
            }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(200);
        const body = await r.json() as { url: string; headers: Record<string, string>; expires_in: number };
        expect(body.url).toMatch(/^https:\/\/a{32}\.r2\.cloudflarestorage\.com\//);
        expect(body.headers['Content-Type']).toBe('application/octet-stream');
        expect(body.headers['x-amz-meta-sha256']).toBe('a'.repeat(64));
        expect(body.expires_in).toBe(600);
    });

    it('200 for dists/ Release with text/plain content-type', async () => {
        const req = new Request('https://x/api/upload/dists/kali-rolling/main/binary-amd64/Release/presign', {
            method: 'POST',
            headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                size: 100, sha256: 'a'.repeat(64), content_type: 'text/plain',
            }),
        });
        const r = await handlePresign(req, presignEnv());
        expect(r.status).toBe(200);
    });
});