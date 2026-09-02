import { describe, it, expect, vi } from 'vitest';
import { getCachedIndex, setCachedIndex, invalidate } from '../src/cache';
import type { PackageEntry } from '../src/env';

const mockKV = () => {
    const store = new Map<string, { value: string; expiration?: number }>();
    return {
        get: vi.fn(async (key: string) => {
            const v = store.get(key);
            if (!v) return null;
            if (v.expiration && Date.now() / 1000 > v.expiration) return null;
            return v.value;
        }),
        put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
            store.set(key, {
                value,
                expiration: opts?.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined,
            });
        }),
        delete: vi.fn(async (key: string) => store.delete(key)),
        list: vi.fn(async ({ prefix }: { prefix: string }) => {
            const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
            return { keys, list_complete: true };
        }),
    };
};

const entry: PackageEntry = {
    Package: 'foo', Version: '1.0', Architecture: 'amd64', Size: 100, Filename: 'p',
};

describe('cache', () => {
    it('miss returns null', async () => {
        const env = { APT_KV: mockKV() } as any;
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toBeNull();
    });

    it('round-trip', async () => {
        const env = { APT_KV: mockKV() } as any;
        await setCachedIndex(env, 'kali-rolling', 'amd64', { etag: 'e1', entries: [entry] });
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toEqual({ etag: 'e1', entries: [entry] });
    });

    it('invalidate clears all arch', async () => {
        const env = { APT_KV: mockKV() } as any;
        await setCachedIndex(env, 'kali-rolling', 'amd64', { etag: 'e1', entries: [entry] });
        await setCachedIndex(env, 'kali-rolling', 'arm64', { etag: 'e2', entries: [entry] });
        await invalidate(env, 'kali-rolling');
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toBeNull();
        expect(await getCachedIndex(env, 'kali-rolling', 'arm64')).toBeNull();
    });

    it('cache hit only when ETag matches current R2', async () => {
        const env: any = {
            APT_KV: mockKV(),
            APT_BUCKET: {
                get: vi.fn(async () => ({ httpEtag: 'etag-current' })),
            },
        };
        await setCachedIndex(env, 'kali-rolling', 'amd64', { etag: 'etag-current', entries: [entry] });
        const { handleIndex } = await import('../src/api-index');
        const r = await handleIndex('kali-rolling', 'amd64', env);
        const json = await r.json() as any;
        expect(json.packages).toEqual([entry]);
        expect((env.APT_BUCKET.get as any).mock.calls.length).toBe(1);
    });

    it('cache miss when ETag differs (R2 updated)', async () => {
        const newEntry: PackageEntry = {
            Package: 'newpkg', Version: '2.0', Architecture: 'amd64', Size: 200,
            Filename: 'pool/main/n/newpkg/newpkg_2.0_amd64.deb', Description: 'new',
        };
        const newPackages = `Package: newpkg\nVersion: 2.0\nArchitecture: amd64\nFilename: pool/main/n/newpkg/newpkg_2.0_amd64.deb\nSize: 200\nDescription: new\n\n`;
        const compressed = new Response(
            new Blob([newPackages]).stream().pipeThrough(new CompressionStream('gzip'))
        );
        const buf = await compressed.arrayBuffer();
        const env: any = {
            APT_KV: mockKV(),
            APT_BUCKET: {
                get: vi.fn(async () => ({
                    httpEtag: 'etag-new',
                    body: new ReadableStream({
                        start(c) {
                            c.enqueue(new Uint8Array(buf));
                            c.close();
                        },
                    }),
                })),
            },
        };
        await setCachedIndex(env, 'kali-rolling', 'amd64', { etag: 'etag-old', entries: [entry] });
        const { handleIndex } = await import('../src/api-index');
        const r = await handleIndex('kali-rolling', 'amd64', env);
        const json = await r.json() as any;
        expect(json.packages).toEqual([newEntry]);
    });
});