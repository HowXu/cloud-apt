import type { Bindings, PackageEntry } from './env';
import { getCachedIndex, setCachedIndex } from './cache';
import { parsePackages } from './parser';

const ARCHS = ['amd64', 'arm64'] as const;
type Arch = typeof ARCHS[number];

async function loadIndex(env: Bindings, suite: string, arch: Arch): Promise<PackageEntry[]> {
    const cached = await getCachedIndex(env, suite, arch);
    if (cached) return cached;

    const bucket = env.APT_BUCKET;
    if (!bucket) return [];

    const obj = await bucket.get(`dists/${suite}/main/binary-${arch}/Packages.gz`);
    if (!obj) return [];

    // Decompress gzip
    const stream = new Response(obj.body).body!.pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    const entries = parsePackages(text);
    await setCachedIndex(env, suite, arch, entries);
    return entries;
}

export async function handleIndex(suite: string, arch: string, env: Bindings): Promise<Response> {
    if (!ARCHS.includes(arch as Arch)) {
        return new Response('Invalid arch', { status: 400 });
    }
    const entries = await loadIndex(env, suite, arch as Arch);
    return Response.json({ packages: entries });
}

export async function handleSearch(
    suite: string,
    arch: string,
    query: string,
    env: Bindings
): Promise<Response> {
    if (!ARCHS.includes(arch as Arch)) {
        return new Response('Invalid arch', { status: 400 });
    }
    const all = await loadIndex(env, suite, arch as Arch);
    const q = query.toLowerCase();
    const filtered = all.filter(
        (p) =>
            p.Package.toLowerCase().includes(q) ||
            (p.Description || '').toLowerCase().includes(q) ||
            (p.Depends || '').toLowerCase().includes(q)
    );
    return Response.json({ packages: filtered });
}