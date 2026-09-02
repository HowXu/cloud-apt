import { describe, it, expect, vi } from 'vitest';
import { handleUpload } from '../src/upload';

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
        expect((e.APT_BUCKET.put as any).mock.calls[0][1]).toBe('release data');
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
});