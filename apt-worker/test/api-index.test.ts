import { describe, it, expect, vi } from 'vitest';
import { handleIndex, handleSearch } from '../src/api-index';

const mockR2 = (files: Record<string, string>) => ({
    get: vi.fn(async (key: string) => {
        const body = files[key];
        if (!body) return null;
        // R2 actually returns gzip-compressed bytes; produce them via CompressionStream
        const compressed = new Response(
            new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
        );
        const buf = await compressed.arrayBuffer();
        return {
            httpEtag: `etag-${key}`,
            body: new ReadableStream({
                start(c) {
                    c.enqueue(new Uint8Array(buf));
                    c.close();
                },
            }),
        };
    }),
});

const samplePackages = `Package: foo
Version: 1.0
Architecture: amd64
Filename: pool/main/f/foo/foo_1.0_amd64.deb
Size: 100
Description: Foo package

Package: bar
Version: 0.5
Architecture: amd64
Filename: pool/main/b/bar/bar_0.5_amd64.deb
Size: 50
Description: Bar with foo in name

`;

describe('handleIndex', () => {
    it('returns packages from cache when etag matches', async () => {
        const env: any = {
            APT_BUCKET: mockR2({
                'dists/kali-rolling/main/binary-amd64/Packages.gz': samplePackages,
            }),
            APT_KV: {
                get: vi.fn(async () => JSON.stringify({
                    etag: 'etag-dists/kali-rolling/main/binary-amd64/Packages.gz',
                    entries: [
                        { Package: 'cached', Version: '1.0', Architecture: 'amd64', Size: 1, Filename: 'x' },
                    ],
                })),
                put: vi.fn(),
                delete: vi.fn(),
            },
        };
        const r = await handleIndex('kali-rolling', 'amd64', env);
        const json = await r.json() as any;
        expect(json.packages[0].Package).toBe('cached');
    });

    it('falls back to R2 on cache miss', async () => {
        const env: any = {
            APT_BUCKET: mockR2({
                'dists/kali-rolling/main/binary-amd64/Packages.gz': samplePackages,
            }),
            APT_KV: {
                get: vi.fn(async () => null),
                put: vi.fn(),
                delete: vi.fn(),
            },
        };
        const r = await handleIndex('kali-rolling', 'amd64', env);
        const json = await r.json() as any;
        expect(json.packages).toHaveLength(2);
        expect(json.packages[0].Package).toBe('foo');
    });

    it('returns 400 on invalid suite', async () => {
        const env: any = {
            APT_BUCKET: mockR2({}),
            APT_KV: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() },
        };
        const r = await handleIndex('foo bar', 'amd64', env);
        expect(r.status).toBe(400);
        expect(await r.text()).toBe('Invalid suite');
    });
});

describe('handleSearch', () => {
    it('filters by query', async () => {
        const env: any = {
            APT_BUCKET: mockR2({
                'dists/kali-rolling/main/binary-amd64/Packages.gz': samplePackages,
            }),
            APT_KV: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() },
        };
        const r = await handleSearch('kali-rolling', 'amd64', 'foo', env);
        const json = await r.json() as any;
        expect(json.packages.length).toBeGreaterThan(0);
        expect(json.packages.every((p: any) => p.Package.toLowerCase().includes('foo') || (p.Description || '').toLowerCase().includes('foo'))).toBe(true);
    });
});