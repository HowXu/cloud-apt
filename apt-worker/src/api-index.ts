import type { Bindings, PackageEntry } from './env';
import { getCachedIndex, setCachedIndex } from './cache';
import { parsePackages } from './parser';
import { validateSuite } from './shared/path';
import { resolveIndexKey } from './releases';

const ARCHS = ['amd64', 'arm64'] as const;
type Arch = typeof ARCHS[number];

function jsonError(status: number, message: string): Response {
    return Response.json({ packages: [], error: message }, { status });
}

async function loadIndex(env: Bindings, suite: string, arch: Arch): Promise<PackageEntry[]> {
    try {
        const bucket = env.APT_BUCKET;
        if (!bucket) return [];

        const obj = await bucket.get(await resolveIndexKey(bucket, `dists/${suite}/main/binary-${arch}/Packages.gz`));
        if (!obj) return [];

        const etag = obj.httpEtag;
        const cached = await getCachedIndex(env, suite, arch);
        if (cached && cached.etag === etag) {
            await obj.body?.cancel();
            return cached.entries;
        }

        // Decompress gzip
        const stream = new Response(obj.body).body!.pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        const entries = parsePackages(text);
        await setCachedIndex(env, suite, arch, { etag, entries });
        return entries;
    } catch (e) {
        console.error(`loadIndex(${suite}, ${arch}) failed:`, e);
        return [];
    }
}

export async function handleIndex(suite: string, arch: string, env: Bindings): Promise<Response> {
    if (!validateSuite(suite)) return jsonError(400, 'Invalid suite');
    if (!ARCHS.includes(arch as Arch)) return jsonError(400, 'Invalid arch');
    try {
        const entries = await loadIndex(env, suite, arch as Arch);
        return Response.json({ packages: entries });
    } catch (e) {
        console.error(`handleIndex(${suite}, ${arch}) failed:`, e);
        return jsonError(500, e instanceof Error ? e.message : 'unknown error');
    }
}

export async function handleSearch(
    suite: string,
    arch: string,
    query: string,
    env: Bindings
): Promise<Response> {
    if (!validateSuite(suite)) return jsonError(400, 'Invalid suite');
    if (!ARCHS.includes(arch as Arch)) return jsonError(400, 'Invalid arch');
    try {
        const all = await loadIndex(env, suite, arch as Arch);
        const q = query.toLowerCase();
        const filtered = all.filter(
            (p) =>
                p.Package.toLowerCase().includes(q) ||
                (p.Description || '').toLowerCase().includes(q) ||
                (p.Depends || '').toLowerCase().includes(q)
        );
        return Response.json({ packages: filtered });
    } catch (e) {
        console.error(`handleSearch(${suite}, ${arch}, ${query}) failed:`, e);
        return jsonError(500, e instanceof Error ? e.message : 'unknown error');
    }
}
