import type { Bindings } from './env';
import { checkAuth } from './shared/auth';
import { validateSuite, validateUploadPath } from './shared/path';

export const releaseKey = (suite: string) => `releases/${suite}.json`;
const RELEASE_ID = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
type FileRecord = { key: string; sha256: string; size: number };

export function isImmutable(key: string): boolean {
    return key.startsWith('pool/') || key.includes('/by-hash/') || key.includes('/.snapshots/');
}

export async function resolveIndexKey(bucket: R2Bucket, key: string): Promise<string> {
    const match = /^dists\/([^/]+)\/(.+)$/.exec(key);
    if (!match || key.includes('/by-hash/') || key.includes('/.snapshots/')) return key;
    const current = await bucket.get(releaseKey(match[1]));
    if (!current) return key; // Existing repositories continue to work until first publish.
    const { release } = await current.json<{ release: string }>();
    if (!RELEASE_ID.test(release)) throw new Error('Invalid current release');
    return `dists/${match[1]}/.snapshots/${release}/${match[2]}`;
}

export async function handlePublish(req: Request, suite: string, env: Bindings): Promise<Response> {
    if (!checkAuth(req, env)) return new Response('Unauthorized', { status: 401 });
    if (!validateSuite(suite)) return new Response('Invalid suite', { status: 400 });
    const bucket = env.APT_BUCKET;
    if (!bucket) return new Response('R2 not bound', { status: 500 });
    if (req.method === 'GET') {
        const current = await bucket.get(releaseKey(suite));
        return Response.json({ release: current ? (await current.json<{ release: string }>()).release : null,
            etag: current?.etag ?? null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    let data: { release: string; previous: string | null; files: FileRecord[] };
    try {
        const body = await req.text();
        if (body.length > 1024 * 1024) return new Response('Manifest too large', { status: 413 });
        data = JSON.parse(body);
        if (!data || !RELEASE_ID.test(data.release) ||
            !(data.previous === null || typeof data.previous === 'string') ||
            !Array.isArray(data.files) || !data.files.length) throw new Error();
        const prefix = `dists/${suite}/.snapshots/${data.release}/`;
        const seen = new Set<string>();
        for (const f of data.files) {
            if (!f || typeof f.key !== 'string' || !validateUploadPath(f.key).ok ||
                !SHA256.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || seen.has(f.key) ||
                !(f.key.startsWith(prefix) || f.key.startsWith('pool/') ||
                    (f.key.startsWith(`dists/${suite}/`) && /\/by-hash\/SHA256\/[a-f0-9]{64}$/.test(f.key)))) throw new Error();
            if (f.key.includes('/by-hash/') && !f.key.endsWith(`/${f.sha256}`)) throw new Error();
            seen.add(f.key);
        }
        for (const name of ['InRelease', 'Release', 'Release.gpg']) {
            if (!seen.has(prefix + name)) throw new Error();
        }
    } catch {
        return new Response('Invalid publication manifest', { status: 400 });
    }
    const current = await bucket.get(releaseKey(suite));
    const active = current ? await current.json<{ release: string; manifest: string }>() : null;
    // Hash the manifest too: a reused id may only retry exactly the same publication.
    const canonical = JSON.stringify([...data.files].sort((a, b) => a.key.localeCompare(b.key)));
    const manifest = await digest(new TextEncoder().encode(canonical));
    if (active) {
        if (active.release === data.release) {
            return active.manifest === manifest ? new Response('OK') : new Response('Release id reused', { status: 409 });
        }
    }
    if ((current?.etag ?? null) !== data.previous) return new Response('Another publication won; sync again', { status: 409 });

    // List metadata in groups instead of a HEAD per file (Workers subrequest limits).
    // Every listed object is immutable, so validation remains true until the commit.
    const groups = new Map<string, Map<string, FileRecord>>();
    for (const f of data.files) {
        const prefix = f.key.startsWith('pool/') ? 'pool/' : f.key.slice(0, f.key.lastIndexOf('/') + 1);
        if (!groups.has(prefix)) groups.set(prefix, new Map());
        groups.get(prefix)!.set(f.key, f);
    }
    for (const [prefix, pending] of groups) {
        let cursor: string | undefined;
        do {
            // R2 supports include, but the default workers-types entrypoint omits it.
            const options: R2ListOptions & { include: string[] } = { prefix, cursor, include: ['customMetadata'] };
            const result = await bucket.list(options);
            for (const obj of result.objects) {
                const expected = pending.get(obj.key);
                if (!expected) continue;
                if (obj.size !== expected.size || obj.customMetadata?.sha256 !== expected.sha256) {
                    return new Response(`Unverified file: ${obj.key}`, { status: 409 });
                }
                pending.delete(obj.key);
            }
            cursor = result.truncated ? result.cursor : undefined;
        } while (cursor && pending.size);
        if (pending.size) return new Response(`Missing file: ${pending.keys().next().value}`, { status: 409 });
    }
    const committed = await bucket.put(releaseKey(suite), JSON.stringify({ release: data.release, manifest }), {
        onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    });
    return committed ? new Response('OK') : new Response('Concurrent publication; sync again', { status: 409 });
}

export async function digest(body: BufferSource): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', body);
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
