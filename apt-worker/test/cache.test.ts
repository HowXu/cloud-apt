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
        await setCachedIndex(env, 'kali-rolling', 'amd64', [entry]);
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toEqual([entry]);
    });

    it('invalidate clears all arch', async () => {
        const env = { APT_KV: mockKV() } as any;
        await setCachedIndex(env, 'kali-rolling', 'amd64', [entry]);
        await setCachedIndex(env, 'kali-rolling', 'arm64', [entry]);
        await invalidate(env, 'kali-rolling');
        expect(await getCachedIndex(env, 'kali-rolling', 'amd64')).toBeNull();
        expect(await getCachedIndex(env, 'kali-rolling', 'arm64')).toBeNull();
    });
});