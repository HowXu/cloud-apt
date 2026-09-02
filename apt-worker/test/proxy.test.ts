import { describe, it, expect, vi } from 'vitest';
import { proxyR2 } from '../src/proxy';

const mockR2 = (files: Record<string, { body: string; type?: string }>) => ({
    get: vi.fn(async (key: string) => {
        const f = files[key];
        if (!f) return null;
        return {
            body: new ReadableStream({
                start(c) {
                    c.enqueue(new TextEncoder().encode(f.body));
                    c.close();
                },
            }),
            httpMetadata: f.type ? { contentType: f.type } : undefined,
            writeHttpMetadata: vi.fn((h: Headers) => {
                if (f.type) h.set('Content-Type', f.type);
            }),
        };
    }),
});

describe('proxyR2', () => {
    it('404 on missing', async () => {
        const env = { APT_BUCKET: mockR2({}) } as any;
        const r = await proxyR2(env, 'missing.txt');
        expect(r.status).toBe(404);
    });

    it('returns body with Cache-Control', async () => {
        const env = { APT_BUCKET: mockR2({ 'hello.txt': { body: 'hi' } }) } as any;
        const r = await proxyR2(env, 'hello.txt');
        expect(r.status).toBe(200);
        expect(r.headers.get('Cache-Control')).toBe('public, max-age=300');
        expect(await r.text()).toBe('hi');
    });

    it('uses explicit contentType override', async () => {
        const env = { APT_BUCKET: mockR2({ 'k.asc': { body: 'PGP' } }) } as any;
        const r = await proxyR2(env, 'k.asc', 'text/plain');
        expect(r.headers.get('Content-Type')).toBe('text/plain');
    });
});